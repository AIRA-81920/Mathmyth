# ---- Mathmyth：开启 R8 后必须保留的东西 -------------------------------------
#
# Capacitor 的插件桥是"按名字"工作的：
#   @CapacitorPlugin(name = "MathmythStream")   → JS 侧的插件名
#   @PluginMethod public void start(...)        → JS 调用的方法名
# 名字被改掉，运行时就变成 "not implemented on Android" 或插件找不到，
# 而这种错误只在 release 包里出现（debug 不压缩），所以下面逐条 keep。

# 1) 官方插件靠 capacitor.plugins.json 里的类名加载（Class.forName），
#    代码里没有任何直接引用，不 keep 就会被摇树删掉 —— 相机、相册、文件系统会直接消失。
-keep class com.capacitorjs.plugins.** { *; }

# 2) 我们自己的插件在 MainActivity 里显式 registerPlugin，类本身不会被删，
#    但方法名必须原样保留（JS 按方法名反射）。
-keep class app.mathmyth.mobile.** { *; }

# 3) Capacitor 的 AAR 自带 consumer 规则，已保留 @CapacitorPlugin 类与其
#    @PluginMethod 方法；这里补上注解属性，保证运行时能读到插件名。
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# 4) 保留行号：崩溃堆栈才指得回源码行（配合同版本的 mapping.txt 反混淆）。
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# 5) Capacitor 的权限表不是写死的，而是反射读 @CapacitorPlugin(permissions = {...})
#    的注解值。release 下 R8 会把这段注解元数据裁掉，于是 getPermissionStates()
#    返回空表、getPermissionState("camera") 变成 null：
#      · 相机插件在 Kotlin 非空断言上直接崩掉整个进程 —— 用户点「拍照」就闪退；
#      · 我们自己的媒体插件把 null 当成"没授权"，于是最近图片永远是空的。
#    所以 Capacitor 核心整体保留，注解属性也要留着。
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep @interface com.getcapacitor.annotation.** { *; }
-keepattributes RuntimeVisibleAnnotations, RuntimeInvisibleAnnotations, AnnotationDefault

# 6) 个别可选依赖在运行时并不存在，别让 R8 因缺引用直接失败。
-dontwarn org.apache.cordova.**
-dontwarn com.getcapacitor.annotation.**
