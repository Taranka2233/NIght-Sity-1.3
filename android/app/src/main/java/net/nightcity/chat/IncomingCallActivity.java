package net.nightcity.chat;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {
    private String callId = "";
    private int notificationId = 0;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager manager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (manager != null) manager.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }

        callId = safe(getIntent().getStringExtra("callId"));
        notificationId = getIntent().getIntExtra("notificationId", 0);
        if (callId.isEmpty()) { finish(); return; }
        String fromName = safe(getIntent().getStringExtra("fromName"));
        String callType = safe(getIntent().getStringExtra("callType"));
        if (fromName.isEmpty()) fromName = "Абонент";

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(48, 96, 48, 96);
        root.setBackgroundColor(Color.parseColor("#0a0a0f"));

        TextView title = new TextView(this);
        title.setText("video".equals(callType) ? "Входящий видеозвонок" : "Входящий звонок");
        title.setTextColor(Color.parseColor("#00f0ff"));
        title.setTextSize(16);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        TextView name = new TextView(this);
        name.setText(fromName);
        name.setTextColor(Color.WHITE);
        name.setTextSize(34);
        name.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nameParams.setMargins(0, 40, 0, 140);
        name.setLayoutParams(nameParams);
        root.addView(name);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        buttonParams.setMargins(24, 0, 24, 0);

        Button decline = new Button(this);
        decline.setText("Отклонить");
        decline.setTextColor(Color.WHITE);
        decline.setBackgroundColor(Color.parseColor("#ff003c"));
        decline.setOnClickListener(view -> openApp("decline"));

        Button accept = new Button(this);
        accept.setText("Принять");
        accept.setTextColor(Color.BLACK);
        accept.setBackgroundColor(Color.parseColor("#3aff8f"));
        accept.setOnClickListener(view -> openApp("accept"));

        buttons.addView(decline, buttonParams);
        buttons.addView(accept, buttonParams);
        root.addView(buttons);
        setContentView(root);
    }

    private void openApp(String action) {
        cancelNotification();
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            Uri uri = new Uri.Builder().scheme("nightcity").authority(action).appendQueryParameter("callId", callId).build();
            launch.setData(uri);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(launch);
        }
        finish();
    }

    private void cancelNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null && notificationId != 0) manager.cancel(notificationId);
    }

    private static String safe(String value) { return value == null ? "" : value; }
}
