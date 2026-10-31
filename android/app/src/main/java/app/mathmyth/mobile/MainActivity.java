package app.mathmyth.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MathmythFilesPlugin.class);
        registerPlugin(MathmythStreamPlugin.class);
        registerPlugin(MathmythMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
