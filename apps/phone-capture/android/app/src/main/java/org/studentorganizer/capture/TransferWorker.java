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
    private static volatile String activeQueueId;
    static boolean isActive(String queueId){return queueId!=null&&queueId.equals(activeQueueId);}
    static State runTracked(TransferEngine engine,String queueId)throws java.io.IOException{activeQueueId=queueId;try{return engine.run(queueId);}finally{activeQueueId=null;}}
    static void accountState(CaptureQueue queue,String account,State state,String detail){for(UploadRecord r:queue.all())if(account.equals(r.accountId)&&r.state!=State.COMPLETE&&r.state!=State.BLOCKED&&(state!=State.RETRY||r.state!=State.NEEDS_AUTH)){r.state=state;r.detail=detail;queue.save(r);}}
    public TransferWorker(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}
    static TransferSettings settings(Context c){return TransferSettings.get(c);}
    static boolean enabled(Context c){return BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED && settings(c).enabled();}
    static AuthorizationRequest request(String email){return AuthorizationRequest.builder().setAccount(new Account(email,"com.google")).setRequestedScopes(Collections.singletonList(new Scope(SCOPE))).build();}
    static void schedule(Context c){
        if(!enabled(c))return;
        Constraints constraints=new Constraints.Builder().setRequiredNetworkType(settings(c).flag("wifiOnly",true)?NetworkType.UNMETERED:NetworkType.CONNECTED).build();
        WorkManager.getInstance(c).enqueueUniqueWork("private-drive-transfer",ExistingWorkPolicy.APPEND_OR_REPLACE,new OneTimeWorkRequest.Builder(TransferWorker.class).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build());
    }
    @NonNull public Result doWork(){synchronized(LOCK){
        Context c=getApplicationContext();TransferSettings p=settings(c);if(!enabled(c))return Result.success();
        String email=p.text("email",""),account=p.text("accountId","");
        try(CaptureQueue queue=new CaptureQueue(c)){
            if(!enabled(c))return Result.success();
            AuthorizationResult auth=Tasks.await(Identity.getAuthorizationClient(c).authorize(request(email)),45,TimeUnit.SECONDS);
            if(auth.hasResolution()||auth.getAccessToken()==null){p.pause("Reconnect Google in settings; queued originals retained");accountState(queue,account,State.NEEDS_AUTH,"Google permission must be renewed before this revision can transfer.");return Result.success();}
            HttpDriveGateway drive=new HttpDriveGateway(auth::getAccessToken,()->enabled(c)&&!isStopped()&&account.equals(p.text("accountId","")));
            if(!account.equals(drive.identity())){p.pause("Google account mismatch; transfers paused");accountState(queue,account,State.BLOCKED,"Google account changed. Reconnect the original account before retrying.");return Result.success();}
            boolean retry=false;
            for(UploadRecord r:queue.all()){
                if(isStopped()||!enabled(c))break;
                if(r.state==State.COMPLETE||!account.equals(r.accountId))continue;
                if(r.state==State.BLOCKED||r.state==State.NEEDS_AUTH)continue;
                State state=runTracked(new TransferEngine(drive,queue,()->enabled(c)&&!isStopped(),()->p.text("accountId","")),r.queueId);
                retry|=state==State.RETRY;
                if(state==State.NEEDS_AUTH){Identity.getAuthorizationClient(c).clearToken(ClearTokenRequest.builder().setToken(auth.getAccessToken()).build());break;}
            }
            return retry?Result.retry():Result.success();
        }catch(Exception e){try(CaptureQueue queue=new CaptureQueue(c)){accountState(queue,account,State.RETRY,"Transfer interrupted before delivery was verified. Check network access; reconnect Google if needed.");}catch(RuntimeException unavailable){/* Preserve originals and existing receipts if status storage also fails. */}return p.setNotice("Transfer interrupted; local originals retained. Reconnect if needed.")?Result.retry():Result.success();}
    }}
}
