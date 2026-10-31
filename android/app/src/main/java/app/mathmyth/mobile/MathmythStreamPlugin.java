package app.mathmyth.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "MathmythStream")
public class MathmythStreamPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, HttpURLConnection> connections = new ConcurrentHashMap<>();
    private final java.util.Set<String> active = ConcurrentHashMap.newKeySet();
    private void event(String id, String type, JSObject data) {
        if (!active.contains(id)) return;
        data.put("id", id); data.put("type", type);
        notifyListeners("httpStream", data);
    }
    @PluginMethod public void start(PluginCall call) {
        String id = call.getString("id"), address = call.getString("url"), body = call.getString("body", "{}");
        JSObject headers = call.getObject("headers", new JSObject());
        if (id == null || address == null || !active.add(id)) { call.reject("Invalid stream request"); return; }
        int connectTimeout = call.getInt("connectTimeout", 15000), readTimeout = call.getInt("readTimeout", 120000);
        call.resolve();
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(address);
                if (!url.getProtocol().equals("https") && !url.getProtocol().equals("http")) throw new Exception("Invalid protocol");
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false); // Never forward a Key to a redirected host.
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setConnectTimeout(connectTimeout); connection.setReadTimeout(readTimeout);
                for (java.util.Iterator<String> it = headers.keys(); it.hasNext();) { String key = it.next(); connection.setRequestProperty(key, headers.optString(key)); }
                connections.put(id, connection);
                if (!active.contains(id)) return;
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
                int status = connection.getResponseCode();
                JSObject start = new JSObject(); start.put("status", status); start.put("contentType", connection.getContentType()); event(id, "start", start);
                InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
                if (stream != null) try (InputStreamReader reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
                    char[] buffer = new char[2048]; int read; String carry = "";
                    while (active.contains(id) && (read = reader.read(buffer)) != -1) {
                        String text = carry + new String(buffer, 0, read); carry = "";
                        if (Character.isHighSurrogate(text.charAt(text.length()-1))) { carry = text.substring(text.length()-1); text = text.substring(0,text.length()-1); }
                        if (!text.isEmpty()) { JSObject chunk = new JSObject(); chunk.put("text", text); event(id, "chunk", chunk); }
                    }
                    if (!carry.isEmpty()) { JSObject chunk = new JSObject(); chunk.put("text", carry); event(id, "chunk", chunk); }
                }
                event(id, "end", new JSObject());
            } catch (Exception error) {
                JSObject failure = new JSObject(); failure.put("code", error instanceof java.net.SocketTimeoutException ? "timeout" : "network");
                event(id, "error", failure); // No request body, Key, URL query or raw exception in logs/events.
            } finally {
                active.remove(id); connections.remove(id);
                if (connection != null) connection.disconnect();
            }
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) { active.remove(id); HttpURLConnection connection = connections.remove(id); if (connection != null) connection.disconnect(); }
        call.resolve();
    }
    @Override protected void handleOnDestroy() {
        active.clear(); connections.values().forEach(HttpURLConnection::disconnect); connections.clear(); executor.shutdownNow();
    }
}
