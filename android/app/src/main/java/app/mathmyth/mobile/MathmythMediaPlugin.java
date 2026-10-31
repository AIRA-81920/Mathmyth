package app.mathmyth.mobile;

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.os.Build;
import android.provider.MediaStore;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(name = "MathmythMedia", permissions = {
    @Permission(alias = "photos", strings = {Manifest.permission.READ_MEDIA_IMAGES}),
    @Permission(alias = "legacyPhotos", strings = {Manifest.permission.READ_EXTERNAL_STORAGE})
})
public class MathmythMediaPlugin extends Plugin {
    @PluginMethod public void hideKeyboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            InputMethodManager manager = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            manager.hideSoftInputFromWindow(getBridge().getWebView().getWindowToken(), 0);
            call.resolve();
        });
    }
    @PluginMethod public void recentPhotos(PluginCall call) {
        String alias = Build.VERSION.SDK_INT >= 33 ? "photos" : "legacyPhotos";
        if (getPermissionState(alias) != PermissionState.GRANTED && !hasPartialAccess()) { requestPermissionForAlias(alias, call, "photosPermission"); return; }
        readPhotos(call);
    }
    @PermissionCallback private void photosPermission(PluginCall call) {
        String alias = Build.VERSION.SDK_INT >= 33 ? "photos" : "legacyPhotos";
        boolean partial = hasPartialAccess();
        if (getPermissionState(alias) != PermissionState.GRANTED && !partial) { JSObject result = new JSObject(); result.put("photos", new JSArray()); result.put("denied", true); call.resolve(result); return; }
        readPhotos(call);
    }
    private boolean hasPartialAccess() {
        return Build.VERSION.SDK_INT >= 34 && getContext().checkSelfPermission("android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }
    private void readPhotos(PluginCall call) {
        new Thread(() -> {
            JSArray photos = new JSArray();
            try (Cursor cursor = getContext().getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME}, null, null, MediaStore.Images.Media.DATE_ADDED + " DESC")) {
                while (cursor != null && cursor.moveToNext() && photos.length() < 12) {
                    long id = cursor.getLong(0);
                    android.net.Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                    Bitmap thumbnail = Build.VERSION.SDK_INT >= 29
                        ? getContext().getContentResolver().loadThumbnail(uri, new android.util.Size(200,200), null)
                        : MediaStore.Images.Thumbnails.getThumbnail(getContext().getContentResolver(), id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                    if (thumbnail == null) continue;
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(); thumbnail.compress(Bitmap.CompressFormat.JPEG, 75, out); thumbnail.recycle();
                    JSObject photo = new JSObject(); photo.put("uri", uri.toString()); photo.put("name", cursor.getString(1));
                    photo.put("thumbnail", "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)); photos.put(photo);
                }
            } catch (Exception ignored) { /* Keep the system picker usable when permission/access changes. */ }
            JSObject result = new JSObject(); result.put("photos", photos); result.put("denied", false); call.resolve(result);
        }).start();
    }
}
