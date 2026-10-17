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
    private File pendingExport;
    private FileOutputStream zipOutput;
    private File zipFile;
    private long zipExpected, zipWritten;
    private String zipToken;
    private int sessionPhotos;
    private int sessionLimit=10;
    private String cameraBatch,cameraSubmission;
    private String pendingEmail;
    private long pendingEpoch;
    private long invalidateAuthorization(){return TransferWorker.settings(this).invalidateAuthorization();}
    private boolean currentAuthorization(long epoch){return TransferWorker.settings(this).currentAuthorization(epoch);}
    private boolean saved(boolean result){if(!result){WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");message(TransferWorker.settings(this).notice());}return result;}
    private static final int PICK=10, SAVE=11, ACCOUNT=12, AUTH=13, CAMERA_LOOP=14;
    private static final String ORIGIN="https://appassets.androidplatform.net";
    @Override public void onCreate(Bundle state){super.onCreate(state);
        if(state!=null){pendingEmail=state.getString("pendingEmail");pendingEpoch=state.getLong("pendingEpoch");sessionPhotos=state.getInt("sessionPhotos");sessionLimit=state.getInt("sessionLimit",10);cameraBatch=state.getString("cameraBatch");cameraSubmission=state.getString("cameraSubmission");String exportName=state.getString("pendingExport");if(exportName!=null&&exportName.matches("[a-f0-9-]{36}\\.zip"))pendingExport=new File(new File(getFilesDir(),"completed-exports"),exportName);}
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
                fileCallback.onReceiveValue(null);fileCallback=null;message("Use Start continuous camera so photos stay with the current student.");
            } else {Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).putExtra(Intent.EXTRA_LOCAL_ONLY,true).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png"}).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);startActivityForResult(intent,PICK);}return true;
        }});
        web.addJavascriptInterface(new Bridge(),"CaptureNative");web.loadUrl(ORIGIN+"/assets/index.html");
        TransferWorker.schedule(this); // Recover scheduling after Activity recreation only when this process still holds explicit consent.
    }
    private void message(String text){runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());}
    private String json(boolean accepted,String error){try{return new JSONObject().put("accepted",accepted).put("error",error==null?JSONObject.NULL:error).toString();}catch(Exception impossible){return "{}";}}
    private byte[] decode(String encoded)throws IOException {if(encoded==null||encoded.length()>((CaptureQueue.MAX_BYTES+2)/3)*4)throw new IOException("Batch exceeds native queue limit");byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);if(bytes.length>CaptureQueue.MAX_BYTES)throw new IOException("Batch too large");return bytes;}
    private File cameraDirectory() throws IOException {File dir=new File(getFilesDir(),"camera-originals");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Camera storage unavailable");return dir;}
    private void event(String name,JSONObject detail){runOnUiThread(()->web.evaluateJavascript("window.dispatchEvent(new CustomEvent("+JSONObject.quote(name)+",{detail:"+detail+"}))",null));}
    private void launchCamera(){try{
        if(sessionPhotos>=sessionLimit){event("capture-preview",new JSONObject());return;}
        String id=UUID.randomUUID().toString();File file=new File(cameraDirectory(),id+".jpg");
        SharedPreferences state=getSharedPreferences("camera-state",MODE_PRIVATE);long sequence=state.getLong("sequence",0)+1;if(!state.edit().putString("active",id).putLong("sequence",sequence).putLong("order-"+id,sequence).putString("batch-"+id,cameraBatch).putString("submission-"+id,cameraSubmission).commit())throw new IOException();
        Uri uri=FileProvider.getUriForFile(this,getPackageName()+".files",file);
        Intent intent=new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("Camera output",uri));startActivityForResult(intent,CAMERA_LOOP);
    }catch(Exception e){message("Camera unavailable. Captured originals are retained; use Preview or Import photos.");event("capture-preview",new JSONObject());}}
    private boolean validPhoto(File file){if(!file.isFile()||file.length()==0||file.length()>8*1024*1024)return false;android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeFile(file.getAbsolutePath(),options);return options.outWidth>0&&options.outHeight>0&&(long)options.outWidth*options.outHeight<=20_000_000&&"image/jpeg".equals(options.outMimeType);}
    private File pendingPhoto(String id)throws IOException{if(id==null||!id.matches("[a-f0-9-]{36}"))throw new IOException();File file=new File(cameraDirectory(),id+".jpg");if(!validPhoto(file))throw new IOException();return file;}
    private final class Bridge {
        private boolean scope(String id,String batch,String submission){SharedPreferences state=getSharedPreferences("camera-state",MODE_PRIVATE);return Objects.equals(batch,state.getString("batch-"+id,null))&&Objects.equals(submission,state.getString("submission-"+id,null))&&batch!=null&&submission!=null;}
        @JavascriptInterface public String startCamera(String batch,String submission,int remaining){try{
            if(batch==null||submission==null||!batch.matches("[A-Za-z0-9_-]{1,80}")||!submission.matches("[A-Za-z0-9_-]{1,80}")||remaining<1||remaining>10)throw new IOException();
            File[] files=cameraDirectory().listFiles();if(files==null)throw new IOException("Cannot enumerate camera originals");if(files!=null)for(File file:files){String id=file.getName().replace(".jpg","");if(file.length()>0&&!getSharedPreferences("camera-state",MODE_PRIVATE).getBoolean("ack-"+id,false)&&!scope(id,batch,submission))return json(false,"Recover the previous student's pending photos before starting another camera session");}
            cameraBatch=batch;cameraSubmission=submission;sessionLimit=remaining;runOnUiThread(()->{sessionPhotos=0;launchCamera();});return json(true,null);
        }catch(Exception e){return json(false,"Camera session unavailable; preserve and recover existing photos");}}
        @JavascriptInterface public String getPendingCaptures(String batch,String submission){try{org.json.JSONArray result=new org.json.JSONArray();File[] files=cameraDirectory().listFiles();if(files==null)throw new IOException("Cannot enumerate camera originals");if(files!=null)Arrays.sort(files,Comparator.comparingLong(file->getSharedPreferences("camera-state",MODE_PRIVATE).getLong("order-"+file.getName().replace(".jpg",""),file.lastModified())));if(files!=null)for(File file:files){String id=file.getName().replace(".jpg","");if(file.length()>0&&scope(id,batch,submission)&&!getSharedPreferences("camera-state",MODE_PRIVATE).getBoolean("ack-"+id,false))result.put(new JSONObject().put("id",id));}return result.toString();}catch(Exception e){return json(false,"Cannot read retained camera originals. Retry before saving this group.");}}
        @JavascriptInterface public String readPendingCapture(String id,String batch,String submission){try{if(!scope(id,batch,submission))throw new IOException();File file=pendingPhoto(id);byte[] bytes=java.nio.file.Files.readAllBytes(file.toPath());return new JSONObject().put("id",id).put("dataUrl","data:image/jpeg;base64,"+Base64.encodeToString(bytes,Base64.NO_WRAP)).toString();}catch(Exception e){return json(false,"Camera original unavailable or exceeds 8 MiB / 20 megapixels. Original retained.");}}
        @JavascriptInterface public String acknowledgeCapture(String id,String batch,String submission){try{if(!scope(id,batch,submission))throw new IOException();pendingPhoto(id);return json(getSharedPreferences("camera-state",MODE_PRIVATE).edit().putBoolean("ack-"+id,true).commit(),null);}catch(Exception e){return json(false,"Could not acknowledge camera original");}}
        @JavascriptInterface public String discardPendingCapture(String id,String batch,String submission){if(!scope(id,batch,submission))return json(false,"Camera session changed");return json(getSharedPreferences("camera-state",MODE_PRIVATE).edit().putBoolean("ack-"+id,true).commit(),null);}
        @JavascriptInterface public synchronized String deleteAssignment(String batch,String capture){try{
            if(batch==null||capture==null||!batch.matches("[A-Za-z0-9_-]{1,80}")||!capture.matches("[A-Za-z0-9_-]{1,80}")||zipOutput!=null||pendingExport!=null)return json(false,"Finish or cancel the pending export before deleting");
            if(!TransferWorker.settings(MainActivity.this).pause("Local assignment deletion; transfers paused"))return json(false,"Could not safely pause transfers");WorkManager.getInstance(MainActivity.this).cancelUniqueWork("private-drive-transfer");
            synchronized(TransferWorker.LOCK){try(CaptureQueue queue=new CaptureQueue(MainActivity.this)){queue.deleteCapture(capture);}SharedPreferences prefs=getSharedPreferences("camera-state",MODE_PRIVATE);File[] files=cameraDirectory().listFiles();if(files==null)throw new IOException("Cannot enumerate camera originals");if(files!=null)for(File file:files){String id=file.getName().replace(".jpg","");if(batch.equals(prefs.getString("batch-"+id,null))&&file.exists()&&!file.delete())throw new IOException();}
                SharedPreferences exports=getSharedPreferences("export-state",MODE_PRIVATE);File directory=new File(getFilesDir(),"completed-exports");File[] zips=directory.listFiles();if(zips!=null)for(File file:zips)if(capture.equals(exports.getString(file.getName(),null))&&file.exists()&&!file.delete())throw new IOException();}
            return json(true,null);
        }catch(Exception e){return json(false,"Some retained files could not be removed. Retry deletion; downloaded and Drive copies remain separate.");}}
        @JavascriptInterface public synchronized String beginZip(long size,String capture){try{if(zipOutput!=null||pendingExport!=null)return json(false,"Another export is pending");if(size<=0||size>256L*1024*1024||capture==null||!capture.matches("[A-Za-z0-9_-]{1,80}"))throw new IOException();File dir=new File(getFilesDir(),"completed-exports");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException();zipToken=UUID.randomUUID().toString();zipFile=new File(dir,zipToken+".zip");if(!getSharedPreferences("export-state",MODE_PRIVATE).edit().putString(zipFile.getName(),capture).commit())throw new IOException();zipOutput=new FileOutputStream(zipFile);zipExpected=size;zipWritten=0;return new JSONObject().put("accepted",true).put("token",zipToken).toString();}catch(Exception e){return json(false,"Cannot prepare local export; check storage");}}
        @JavascriptInterface public synchronized String appendZip(String token,String base64){try{if(zipOutput==null||!Objects.equals(token,zipToken)||base64.length()>350000)throw new IOException();byte[] bytes=Base64.decode(base64,Base64.NO_WRAP);if(bytes.length>262144||zipWritten+bytes.length>zipExpected)throw new IOException();zipOutput.write(bytes);zipWritten+=bytes.length;return json(true,null);}catch(Exception e){return json(false,"Export chunk failed; original batch retained");}}
        @JavascriptInterface public synchronized String cancelZip(String token){if(Objects.equals(token,zipToken)){try{if(zipOutput!=null)zipOutput.close();}catch(IOException ignored){}zipOutput=null;zipToken=null;}return json(true,null);}
        @JavascriptInterface public synchronized String finishZip(String token,String captureId,long revision,String mode){try{
            if(zipOutput==null||!Objects.equals(token,zipToken)||zipWritten!=zipExpected||!Objects.equals(captureId,getSharedPreferences("export-state",MODE_PRIVATE).getString(zipFile.getName(),null)))throw new IOException();zipOutput.getFD().sync();zipOutput.close();zipOutput=null;
            CaptureQueue.validate(zipFile,captureId,revision);
            if(!getSharedPreferences("export-state",MODE_PRIVATE).edit().putString(zipFile.getName(),captureId).commit())throw new IOException();
            if("drive".equals(mode)){if(!TransferWorker.enabled(MainActivity.this))return json(false,"Private Drive transfer is off");try(CaptureQueue queue=new CaptureQueue(MainActivity.this)){queue.enqueue(zipFile,captureId,revision,TransferWorker.settings(MainActivity.this).text("accountId",""));}TransferWorker.schedule(MainActivity.this);}
            else if("local".equals(mode)){pendingExport=zipFile;runOnUiThread(()->{try{startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).putExtra(Intent.EXTRA_LOCAL_ONLY,true).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip").putExtra(Intent.EXTRA_TITLE,"assignment-"+captureId+".zip"),SAVE);}catch(Exception e){pendingExport=null;message("No local document destination available; completed ZIP retained");}});}
            else throw new IOException();zipToken=null;return json(true,null);
        }catch(Exception e){return json(false,"Completed ZIP could not be accepted; originals retained");}}
        @JavascriptInterface public String getTransferStatus(){try{
            TransferSettings p=TransferWorker.settings(MainActivity.this);StringBuilder summary=new StringBuilder(p.notice());
            try(CaptureQueue queue=new CaptureQueue(MainActivity.this)){for(UploadRecord record:queue.all()) summary.append("\n").append(record.name).append(": ").append(record.state).append(" — ").append(record.detail);}
            return new JSONObject().put("available",BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED).put("enabled",TransferWorker.enabled(MainActivity.this)).put("wifiOnly",p.flag("wifiOnly",true)).put("summary",summary.toString()).toString();
        }catch(Exception e){return "{\"available\":false,\"enabled\":false,\"wifiOnly\":true,\"summary\":\"Local queue unavailable\"}";}}
        @JavascriptInterface public void requestDriveSetup(){runOnUiThread(()->showSettings());}
        @JavascriptInterface public String enqueueCapture(String base64,String captureId,long revision){return json(false,"Use completed assignment transfer");}
        @JavascriptInterface public String saveLocalZip(String base64,String filename){return json(false,"Use completed assignment export");}

    }
    private void showSettings(){
        TransferSettings p=TransferWorker.settings(this);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(24,24,24,24);
        TextView info=new TextView(this);info.setText("Fictional pilot only. Batches travel directly to your private Google Drive. This app makes no AI/OCR calls and uses no relay or analytics. Transfer pauses after this app process restarts; reopen settings and explicitly enable to resume retained batches. Enabling transfer creates and uses a private assignment-named folder in the chosen account; it never changes sharing permissions. Pause stops subsequent requests; an in-flight chunk may finish. Desktop: choose Upload picture assignment, open the ZIP and confirm each student. Originals stay on this phone.\nAccount: "+p.text("email","Not connected")+"\n"+p.notice());layout.addView(info);
        if(!BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED){TextView gate=new TextView(this);gate.setText("Private Drive is not configured in this pilot build. Local capture/export remain available; approved account setup must be completed before connecting.");layout.addView(gate);new AlertDialog.Builder(this).setTitle("Private Drive settings").setView(layout).setPositiveButton("Close",null).show();return;}
        Button connect=new Button(this);connect.setText("Choose Google account / reconnect");layout.addView(connect);connect.setOnClickListener(v->{pendingEpoch=invalidateAuthorization();if(!saved(p.pause("Choose and connect an account; transfers paused")))return;pendingEpoch=invalidateAuthorization();WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");startActivityForResult(AccountManager.newChooseAccountIntent(null,null,new String[]{"com.google"},null,null,null,null),ACCOUNT);});
        boolean[] reflecting={false};
        Switch auto=new Switch(this);auto.setText("Enable deliberate transfer of completed assignments");auto.setChecked(TransferWorker.enabled(this));layout.addView(auto);auto.setOnCheckedChangeListener((button,checked)->{if(reflecting[0])return;if(checked&&p.text("accountId","").isEmpty()){auto.setChecked(false);message("Connect an account first");return;}if(!saved(p.setEnabled(checked))){reflecting[0]=true;auto.setChecked(false);reflecting[0]=false;return;}if(checked)TransferWorker.schedule(this);else WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");});
        Switch wifi=new Switch(this);wifi.setText("Wi-Fi / unmetered networks only");wifi.setChecked(p.flag("wifiOnly",true));layout.addView(wifi);wifi.setOnCheckedChangeListener((button,checked)->{if(reflecting[0])return;if(!saved(p.setWifiOnly(checked))){reflecting[0]=true;wifi.setChecked(p.flag("wifiOnly",true));auto.setChecked(false);reflecting[0]=false;return;}WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");TransferWorker.schedule(this);});
        Button retry=new Button(this);retry.setText("Retry retained batches for this account");layout.addView(retry);retry.setOnClickListener(v->{try(CaptureQueue queue=new CaptureQueue(this)){queue.retryForAccount(p.text("accountId",""));}catch(RuntimeException error){saved(p.pause("Queue update failed. Originals retained; free storage before trying again."));reflecting[0]=true;auto.setChecked(false);reflecting[0]=false;message(p.notice());return;}TransferWorker.schedule(this);});
        Button disconnect=new Button(this);disconnect.setText("Disconnect / revoke Google permission");layout.addView(disconnect);disconnect.setOnClickListener(v->{invalidateAuthorization();String email=p.text("email","");boolean disconnected=saved(p.disconnect());WorkManager.getInstance(this).cancelUniqueWork("private-drive-transfer");reflecting[0]=true;auto.setChecked(false);reflecting[0]=false;if(disconnected&&!email.isEmpty())Identity.getAuthorizationClient(this).revokeAccess(RevokeAccessRequest.builder().setAccount(new Account(email,"com.google")).setScopes(Collections.singletonList(new Scope(TransferWorker.SCOPE))).build()).addOnFailureListener(e->message("Local transfer stopped. Google revocation failed; revoke in Google account settings."));});
        new AlertDialog.Builder(this).setTitle("Private Drive settings").setView(layout).setPositiveButton("Close",null).show();
    }
    private void authorize(String email){pendingEmail=email;final long epoch=pendingEpoch;if(!currentAuthorization(epoch))return;Identity.getAuthorizationClient(this).authorize(TransferWorker.request(email)).addOnSuccessListener(result->{if(!currentAuthorization(epoch))return;if(result.hasResolution()){try{startIntentSenderForResult(result.getPendingIntent().getIntentSender(),AUTH,null,0,0,0);}catch(Exception e){message("Google permission was not completed");}}else finishAuthorization(result,email,epoch);}).addOnFailureListener(e->message("Google connection failed; local capture is available"));}
    private void finishAuthorization(AuthorizationResult result,String email,long epoch){if(email==null||result.getAccessToken()==null||!currentAuthorization(epoch)){message("Choose the account again");return;}new Thread(()->{try{HttpDriveGateway drive=new HttpDriveGateway(result::getAccessToken,()->BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED&&currentAuthorization(epoch));String id=drive.identity();if(!saved(TransferWorker.settings(this).connect(email,id,epoch)))return;message("Connected; automatic transfer remains off");}catch(Exception e){message("Could not verify Google account; transfer remains off");}},"capture-account-check").start();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request==PICK&&fileCallback!=null){List<Uri> uris=new ArrayList<>();if(result==RESULT_OK){if(cameraUri!=null)uris.add(cameraUri);else if(data!=null&&data.getClipData()!=null){for(int i=0;i<Math.min(data.getClipData().getItemCount(),100);i++)uris.add(data.getClipData().getItemAt(i).getUri());}else if(data!=null&&data.getData()!=null)uris.add(data.getData());}fileCallback.onReceiveValue(uris.isEmpty()?null:uris.toArray(new Uri[0]));fileCallback=null;cameraUri=null;}
        if(request==CAMERA_LOOP){String id=getSharedPreferences("camera-state",MODE_PRIVATE).getString("active",null);getSharedPreferences("camera-state",MODE_PRIVATE).edit().remove("active").commit();try{File file=pendingPhoto(id);try(FileOutputStream savedPhoto=new FileOutputStream(file,true)){savedPhoto.getFD().sync();}java.io.FileDescriptor cameraDir=android.system.Os.open(cameraDirectory().getAbsolutePath(),android.system.OsConstants.O_RDONLY,0);try{android.system.Os.fsync(cameraDir);}finally{android.system.Os.close(cameraDir);}sessionPhotos++;event("capture-photo",new JSONObject().put("id",id));if(result==RESULT_OK){launchCamera();}else event("capture-preview",new JSONObject());}catch(Exception e){File rejected=null;try{if(id!=null&&id.matches("[a-f0-9-]{36}"))rejected=new File(cameraDirectory(),id+".jpg");}catch(IOException ignored){}if(rejected!=null&&rejected.length()>0)new AlertDialog.Builder(this).setTitle("Photo could not be imported").setMessage("Check free storage and camera size (maximum 8 MiB and 20 megapixels). Its original stays in this assignment until you explicitly delete the assignment.").setPositiveButton("Retain original and skip",(dialog,which)->{getSharedPreferences("camera-state",MODE_PRIVATE).edit().putBoolean("ack-"+id,true).commit();event("capture-preview",new JSONObject());}).setCancelable(false).show();else {message("Capture stopped. Saved photos remain available in Preview.");event("capture-preview",new JSONObject());}}}
        if(request==SAVE){File file=pendingExport;pendingExport=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&file!=null){Uri uri=data.getData();new Thread(()->{try(OutputStream out=getContentResolver().openOutputStream(uri,"wt");InputStream in=new FileInputStream(file)){if(out==null)throw new IOException();byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);out.flush();message("Local ZIP saved; originals retained");}catch(Exception e){message("ZIP save failed; original batch retained");}},"capture-local-export").start();}else message("ZIP save cancelled; original retained");}

        if(request==ACCOUNT&&result==RESULT_OK&&data!=null){String email=data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);if(email!=null)authorize(email);}
        if(request==AUTH&&result==RESULT_OK&&data!=null){try{finishAuthorization(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data),pendingEmail,pendingEpoch);}catch(Exception e){message("Google permission was not completed");}}
    }
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);out.putString("pendingEmail",pendingEmail);out.putLong("pendingEpoch",pendingEpoch);out.putInt("sessionPhotos",sessionPhotos);out.putInt("sessionLimit",sessionLimit);out.putString("cameraBatch",cameraBatch);out.putString("cameraSubmission",cameraSubmission);if(pendingExport!=null)out.putString("pendingExport",pendingExport.getName());}
    @Override protected void onDestroy(){try{if(zipOutput!=null)zipOutput.close();}catch(IOException ignored){}invalidateAuthorization();if(fileCallback!=null)fileCallback.onReceiveValue(null);if(web!=null){web.removeJavascriptInterface("CaptureNative");web.destroy();}super.onDestroy();}
}
