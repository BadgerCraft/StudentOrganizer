package org.studentorganizer.capture;
import android.app.*;
import android.accounts.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.*;
import android.widget.*;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import androidx.work.WorkManager;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import org.json.JSONObject;
import org.studentorganizer.capture.transfer.*;
import org.studentorganizer.capture.transfer.TransferEngine.State;
import java.io.*;
import java.util.*;

public final class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private byte[] pendingExport;
    private String pendingEmail;
    private long pendingEpoch;
    private static final Object AUTH_LOCK=new Object();
    private long invalidateAuthorization(){synchronized(AUTH_LOCK){SharedPreferences p=TransferWorker.prefs(this);long epoch=p.getLong("authEpoch",0)+1;p.edit().putLong("authEpoch",epoch).commit();return epoch;}}
    private boolean currentAuthorization(long epoch){return epoch==TransferWorker.prefs(this).getLong("authEpoch",0);}
    private static final int PICK=10, SAVE=11, ACCOUNT=12, AUTH=13;
    private static final String ORIGIN="https://appassets.androidplatform.net";
    @Override public void onCreate(Bundle state){super.onCreate(state);
        if(state!=null){pendingEmail=state.getString("pendingEmail");pendingEpoch=state.getLong("pendingEpoch");}
        web=new WebView(this);setContentView(web);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(false);
        WebViewAssetLoader assets=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl(); if("https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost())&&uri.getPort()==-1&&request.getMethod().equals("GET")) {WebResourceResponse response=assets.shouldInterceptRequest(uri);if(response!=null)return response;}
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
        });
        web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
            if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;cameraUri=null;
            if(params.isCaptureEnabled()){
                try {File dir=new File(getCacheDir(),"camera");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException();File file=File.createTempFile("capture-",".jpg",dir);cameraUri=FileProvider.getUriForFile(MainActivity.this,getPackageName()+".files",file);Intent intent=new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,cameraUri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("Camera output",cameraUri));startActivityForResult(intent,PICK);}
                catch(Exception e){cameraUri=null;fileCallback.onReceiveValue(null);fileCallback=null;message("Camera unavailable; use Import photos.");}
            } else {Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).putExtra(Intent.EXTRA_LOCAL_ONLY,true).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png"}).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);startActivityForResult(intent,PICK);}return true;
        }});
        web.addJavascriptInterface(new Bridge(),"CaptureNative");web.loadUrl(ORIGIN+"/assets/index.html");
        TransferWorker.schedule(this); // Recover a committed queue item if the process stopped before scheduling.
    }
    private void message(String text){runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());}
    private String json(boolean accepted,String error){try{return new JSONObject().put("accepted",accepted).put("error",error==null?JSONObject.NULL:error).toString();}catch(Exception impossible){return "{}";}}
    private byte[] decode(String encoded)throws IOException {if(encoded==null||encoded.length()>((CaptureQueue.MAX_BYTES+2)/3)*4)throw new IOException("Batch exceeds native queue limit");byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);if(bytes.length>CaptureQueue.MAX_BYTES)throw new IOException("Batch too large");return bytes;}
    private final class Bridge {
        @JavascriptInterface public String getTransferStatus(){try{
            SharedPreferences p=TransferWorker.prefs(MainActivity.this);StringBuilder summary=new StringBuilder(p.getString("notice","Local originals retained. Private Drive transfer is opt-in."));
            try(CaptureQueue queue=new CaptureQueue(MainActivity.this)){for(UploadRecord record:queue.all()) summary.append("\n").append(record.name).append(": ").append(record.state).append(" — ").append(record.detail);}
            return new JSONObject().put("available",BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED).put("enabled",TransferWorker.enabled(MainActivity.this)).put("wifiOnly",p.getBoolean("wifiOnly",true)).put("summary",summary.toString()).toString();
        }catch(Exception e){return "{\"available\":false,\"enabled\":false,\"wifiOnly\":true,\"summary\":\"Local queue unavailable\"}";}}
        @JavascriptInterface public void requestDriveSetup(){runOnUiThread(()->showSettings());}
        @JavascriptInterface public String enqueueCapture(String base64,String captureId,long revision){try{
            if(!TransferWorker.enabled(MainActivity.this))return json(false,"Private Drive transfer is off");
            String account=TransferWorker.prefs(MainActivity.this).getString("accountId","");byte[] bytes=decode(base64);
            try(CaptureQueue queue=new CaptureQueue(MainActivity.this)){queue.enqueue(bytes,captureId,revision,account);}TransferWorker.schedule(MainActivity.this);return json(true,null);
        }catch(Exception e){return json(false,"Batch could not be retained safely. Check labels, space and batch size.");}}
        @JavascriptInterface public synchronized String saveLocalZip(String base64,String filename){try{
            if(pendingExport!=null)return json(false,"An export is already awaiting a destination");pendingExport=decode(base64);
            String safe=filename!=null&&filename.matches("[a-zA-Z0-9._-]{1,150}\\.zip")?filename:"capture.zip";
            runOnUiThread(()->{try{startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).putExtra(Intent.EXTRA_LOCAL_ONLY,true).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip").putExtra(Intent.EXTRA_TITLE,safe),SAVE);}catch(Exception e){pendingExport=null;message("No local document destination available");}});return json(true,null);
        }catch(Exception e){pendingExport=null;return json(false,"Export could not be prepared");}}
    }
    private void showSettings(){
        SharedPreferences p=TransferWorker.prefs(this);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(24,24,24,24);
        TextView info=new TextView(this);info.setText("Fictional pilot only. Batches travel directly to your private Google Drive. This app makes no AI/OCR calls and uses no relay or analytics. Enabling transfer creates and uses a dedicated StudentOrganizer Capture (private) folder in the chosen account; it never changes sharing permissions. Pause stops subsequent requests; an in-flight chunk may finish. Desktop: extract ZIP and manually import photos; confirm every student. Originals stay on this phone.\nAccount: "+p.getString("email","Not connected")+"\n"+p.getString("notice",""));layout.addView(info);
        if(!BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED){TextView gate=new TextView(this);gate.setText("Private Drive is not configured in this pilot build. Local capture/export remain available; approved account setup must be completed before connecting.");layout.addView(gate);new AlertDialog.Builder(this).setTitle("Private Drive settings").setView(layout).setPositiveButton("Close",null).show();return;}
        Button connect=new Button(this);connect.setText("Choose Google account / reconnect");layout.addView(connect);connect.setOnClickListener(v->{pendingEpoch=invalidateAuthorization();p.edit().putBoolean("enabled",false).commit();WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");startActivityForResult(AccountManager.newChooseAccountIntent(null,null,new String[]{"com.google"},null,null,null,null),ACCOUNT);});
        Switch auto=new Switch(this);auto.setText("Automatically queue saved, fully labelled batches");auto.setChecked(TransferWorker.enabled(this));layout.addView(auto);auto.setOnCheckedChangeListener((button,checked)->{if(checked&&p.getString("accountId","").isEmpty()){auto.setChecked(false);message("Connect an account first");return;}p.edit().putBoolean("enabled",checked).commit();if(checked)TransferWorker.schedule(this);else WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");});
        Switch wifi=new Switch(this);wifi.setText("Wi-Fi / unmetered networks only");wifi.setChecked(p.getBoolean("wifiOnly",true));layout.addView(wifi);wifi.setOnCheckedChangeListener((button,checked)->{p.edit().putBoolean("wifiOnly",checked).commit();WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");TransferWorker.schedule(this);});
        Button retry=new Button(this);retry.setText("Retry retained batches for this account");layout.addView(retry);retry.setOnClickListener(v->{try(CaptureQueue queue=new CaptureQueue(this)){for(UploadRecord r:queue.all())if(r.state!=State.COMPLETE&&r.accountId.equals(p.getString("accountId",""))){r.state=State.QUEUED;queue.save(r);}}TransferWorker.schedule(this);});
        Button disconnect=new Button(this);disconnect.setText("Disconnect / revoke Google permission");layout.addView(disconnect);disconnect.setOnClickListener(v->{invalidateAuthorization();String email=p.getString("email","");p.edit().putBoolean("enabled",false).remove("accountId").remove("email").putString("notice","Disconnected locally; originals retained").commit();WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");auto.setChecked(false);if(!email.isEmpty())Identity.getAuthorizationClient(this).revokeAccess(RevokeAccessRequest.builder().setAccount(new Account(email,"com.google")).setScopes(Collections.singletonList(new Scope(TransferWorker.SCOPE))).build()).addOnFailureListener(e->message("Local transfer stopped. Google revocation failed; revoke in Google account settings."));});
        new AlertDialog.Builder(this).setTitle("Private Drive settings").setView(layout).setPositiveButton("Close",null).show();
    }
    private void authorize(String email){pendingEmail=email;final long epoch=pendingEpoch;if(!currentAuthorization(epoch))return;Identity.getAuthorizationClient(this).authorize(TransferWorker.request(email)).addOnSuccessListener(result->{if(!currentAuthorization(epoch))return;if(result.hasResolution()){try{startIntentSenderForResult(result.getPendingIntent().getIntentSender(),AUTH,null,0,0,0);}catch(Exception e){message("Google permission was not completed");}}else finishAuthorization(result,email,epoch);}).addOnFailureListener(e->message("Google connection failed; local capture is available"));}
    private void finishAuthorization(AuthorizationResult result,String email,long epoch){if(email==null||result.getAccessToken()==null||!currentAuthorization(epoch)){message("Choose the account again");return;}new Thread(()->{try{HttpDriveGateway drive=new HttpDriveGateway(result::getAccessToken,()->BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED&&currentAuthorization(epoch));String id=drive.identity();synchronized(AUTH_LOCK){if(!currentAuthorization(epoch))return;TransferWorker.prefs(this).edit().putString("email",email).putString("accountId",id).putBoolean("enabled",false).putString("notice","Connected. Enable automatic transfer explicitly in settings.").commit();}message("Connected; automatic transfer remains off");}catch(Exception e){message("Could not verify Google account; transfer remains off");}},"capture-account-check").start();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request==PICK&&fileCallback!=null){List<Uri> uris=new ArrayList<>();if(result==RESULT_OK){if(cameraUri!=null)uris.add(cameraUri);else if(data!=null&&data.getClipData()!=null){for(int i=0;i<Math.min(data.getClipData().getItemCount(),100);i++)uris.add(data.getClipData().getItemAt(i).getUri());}else if(data!=null&&data.getData()!=null)uris.add(data.getData());}fileCallback.onReceiveValue(uris.isEmpty()?null:uris.toArray(new Uri[0]));fileCallback=null;cameraUri=null;}
        if(request==SAVE){byte[] bytes=pendingExport;pendingExport=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&bytes!=null){Uri uri=data.getData();new Thread(()->{try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();out.write(bytes);out.flush();message("Local ZIP saved; originals retained");}catch(Exception e){message("ZIP save failed; original batch retained");}},"capture-local-export").start();}else message("ZIP save cancelled; original retained");}
        if(request==ACCOUNT&&result==RESULT_OK&&data!=null){String email=data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);if(email!=null)authorize(email);}
        if(request==AUTH&&result==RESULT_OK&&data!=null){try{finishAuthorization(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data),pendingEmail,pendingEpoch);}catch(Exception e){message("Google permission was not completed");}}
    }
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);out.putString("pendingEmail",pendingEmail);out.putLong("pendingEpoch",pendingEpoch);}
    @Override protected void onDestroy(){invalidateAuthorization();if(fileCallback!=null)fileCallback.onReceiveValue(null);if(web!=null){web.removeJavascriptInterface("CaptureNative");web.destroy();}super.onDestroy();}
}
