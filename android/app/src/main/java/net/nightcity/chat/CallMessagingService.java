package net.nightcity.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class CallMessagingService extends com.capacitorjs.plugins.pushnotifications.MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        if (data != null && "call".equals(data.get("type"))) showIncomingCall(data);
    }

    private void showIncomingCall(Map<String, String> data) {
        String callId = safe(data.get("callId"));
        if (callId.isEmpty()) return;
        String chatId = safe(data.get("chatId"));
        String fromName = safe(data.get("fromName"));
        String fromUid = safe(data.get("fromUid"));
        String callType = "video".equals(data.get("callType")) ? "video" : "audio";
        if (fromName.isEmpty()) fromName = "Абонент";

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("calls", "Звонки", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Входящие звонки");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 350, 500, 350, 500});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(channel);
        }

        int notificationId = 1000 + (callId.hashCode() & 0x3fffffff) % 1_000_000;
        Intent fullIntent = new Intent(this, IncomingCallActivity.class)
                .putExtra("callId", callId)
                .putExtra("chatId", chatId)
                .putExtra("fromName", fromName)
                .putExtra("fromUid", fromUid)
                .putExtra("callType", callType)
                .putExtra("notificationId", notificationId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullScreen = PendingIntent.getActivity(this, notificationId, fullIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, "calls")
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle(fromName)
                .setContentText("video".equals(callType) ? "Входящий видеозвонок" : "Входящий звонок")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(fullScreen);

        boolean fullScreenAllowed = true;
        if (Build.VERSION.SDK_INT >= 34) fullScreenAllowed = manager.canUseFullScreenIntent();
        if (fullScreenAllowed) builder.setFullScreenIntent(fullScreen, true);
        manager.notify(notificationId, builder.build());
    }

    private static String safe(String value) { return value == null ? "" : value; }
}
