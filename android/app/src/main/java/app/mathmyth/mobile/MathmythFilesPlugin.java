package app.mathmyth.mobile;

import android.app.Activity;
import android.content.Intent;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.UUID;

@CapacitorPlugin(name = "MathmythFiles")
public class MathmythFilesPlugin extends Plugin {
    @PluginMethod
    public void saveBackup(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename", "Mathmyth.sqlite");
        if (data == null || data.isEmpty()) { call.reject("No backup data"); return; }
        // Activity state crosses Android's Binder limit. Persist only a short
        // cache-file reference, never the complete base64 database in a Bundle.
        File directory = new File(getContext().getCacheDir(), "exports");
        File temporary = new File(directory, UUID.randomUUID().toString() + ".sqlite");
        try {
            if (!directory.exists() && !directory.mkdirs()) throw new java.io.IOException("Cache unavailable");
            try (OutputStream output = new FileOutputStream(temporary)) { output.write(Base64.decode(data, Base64.DEFAULT)); }
            call.getData().remove("data");
            call.getData().put("temporaryFile", temporary.getAbsolutePath());
        } catch (Exception error) { temporary.delete(); call.reject("Unable to prepare backup"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        try { startActivityForResult(call, intent, "backupDestination"); }
        catch (Exception error) { temporary.delete(); call.reject("File chooser unavailable"); }
    }

    @ActivityCallback
    private void backupDestination(PluginCall call, ActivityResult result) {
        if (call == null) return;
        File temporary = new File(call.getString("temporaryFile", ""));
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            temporary.delete();
            response.put("saved", false); call.resolve(response); return;
        }
        try (FileInputStream input = new FileInputStream(temporary);
             OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
            if (output == null) throw new java.io.IOException("No file stream");
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
            output.flush(); response.put("saved", true); call.resolve(response);
        } catch (Exception error) { call.reject("Unable to save backup"); }
        finally { temporary.delete(); }
    }
}
