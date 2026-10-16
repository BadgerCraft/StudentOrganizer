package org.studentorganizer.capture;
import android.accounts.Account;
import android.content.*;
import androidx.annotation.NonNull;
import androidx.work.*;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import org.studentorganizer.capture.transfer.*;
import org.studentorganizer.capture.transfer.TransferEngine.State;
import java.util.*;
import java.util.concurrent.TimeUnit;

public final class TransferWorker extends Worker {
    static final String SCOPE="https://www.googleapis.com/auth/drive.file";
    static final Object LOCK=new Object();
    public TransferWorker(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}
    static SharedPreferences prefs(Context c){return c.getSharedPreferences("private-drive",Context.MODE_PRIVATE);}
    static boolean enabled(Context c){return BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED && prefs(c).getBoolean("enabled",false) && !prefs(c).getString("accountId","").isEmpty();}
    static AuthorizationRequest request(String email){return AuthorizationRequest.builder().setAccount(new Account(email,"com.google")).setRequestedScopes(Collections.singletonList(new Scope(SCOPE))).build();}
    static void schedule(Context c){
        if(!enabled(c))return;
        Constraints constraints=new Constraints.Builder().setRequiredNetworkType(prefs(c).getBoolean("wifiOnly",true)?NetworkType.UNMETERED:NetworkType.CONNECTED).build();
        WorkManager.getInstance(c).enqueueUniqueWork("private-drive-transfer",ExistingWorkPolicy.APPEND_OR_REPLACE,new OneTimeWorkRequest.Builder(TransferWorker.class).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build());
    }
    @NonNull public Result doWork(){synchronized(LOCK){
        Context c=getApplicationContext();SharedPreferences p=prefs(c);if(!enabled(c))return Result.success();
        String email=p.getString("email",""),account=p.getString("accountId","");
        try(CaptureQueue queue=new CaptureQueue(c)){
            AuthorizationResult auth=Tasks.await(Identity.getAuthorizationClient(c).authorize(request(email)),45,TimeUnit.SECONDS);
            if(auth.hasResolution()||auth.getAccessToken()==null){p.edit().putString("notice","Reconnect Google in settings; queued originals retained").commit();return Result.success();}
            HttpDriveGateway drive=new HttpDriveGateway(auth::getAccessToken,()->enabled(c)&&!isStopped()&&account.equals(p.getString("accountId","")));
            if(!account.equals(drive.identity())){p.edit().putBoolean("enabled",false).putString("notice","Google account mismatch; transfers paused").commit();return Result.success();}
            String folder=p.getString("folder-"+account,""),root=drive.rootId();
            if(folder.isEmpty()){folder=drive.generateId();if(!p.edit().putString("folder-"+account,folder).commit())throw new java.io.IOException("Cannot persist folder ID");}
            if(drive.metadata(folder)==null){try{drive.createFolder(folder,"StudentOrganizer Capture (private)");}catch(DriveGateway.Failure e){if(e.status!=409)throw e;}}
            DriveGateway.Metadata metadata=drive.metadata(folder);
            if(!TransferEngine.privateOwned(metadata,account)||!"application/vnd.google-apps.folder".equals(metadata.mimeType)||metadata.parents==null||metadata.parents.size()!=1||!metadata.parents.contains(root)){p.edit().putBoolean("enabled",false).putString("notice","Destination is shared or moved. Transfer paused; no permissions were changed.").commit();return Result.success();}
            boolean retry=false;
            for(UploadRecord r:queue.all()){
                if(isStopped()||!enabled(c))break;
                if(r.state==State.COMPLETE||!account.equals(r.accountId))continue;
                if(r.state==State.BLOCKED||r.state==State.NEEDS_AUTH)continue;
                if(r.folderId==null){r.folderId=folder;r.folderParentId=root;queue.save(r);}
                State state=new TransferEngine(drive,queue,()->enabled(c)&&!isStopped(),()->p.getString("accountId","")).run(r.queueId);
                retry|=state==State.RETRY;
                if(state==State.NEEDS_AUTH){Identity.getAuthorizationClient(c).clearToken(ClearTokenRequest.builder().setToken(auth.getAccessToken()).build());break;}
            }
            return retry?Result.retry():Result.success();
        }catch(Exception e){p.edit().putString("notice","Transfer interrupted; local originals retained. Reconnect if needed.").commit();return Result.retry();}
    }}
}
