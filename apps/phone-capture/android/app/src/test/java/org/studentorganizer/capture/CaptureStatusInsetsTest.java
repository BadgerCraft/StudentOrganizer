package org.studentorganizer.capture;

import android.content.*;
import android.widget.FrameLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowInsetsCompat;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.studentorganizer.capture.transfer.*;
import java.io.IOException;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=35)
public class CaptureStatusInsetsTest {
    Context context;
    @Before public void setup(){context=RuntimeEnvironment.getApplication();context.deleteDatabase("capture-transfer.db");}
    private UploadRecord record(TransferEngine.State state){UploadRecord r=new UploadRecord();r.queueId="queue";r.accountId="original-account";r.state=state;r.detail="Session expired; retry will use the same file ID";return r;}
    private void insert(CaptureQueue queue,String id,String capture,long revision,TransferEngine.State state,String account)throws Exception{
        ContentValues values=new ContentValues();values.put("id",id);values.put("capture",capture);values.put("revision",revision);values.put("digest","fictional-digest");values.put("record",new JSONObject().put("queueId",id).put("accountId",account).put("state",state.name()).put("detail","Fictional retained status").put("fileId","stable-remote-id").toString());queue.getWritableDatabase().insertOrThrow("queue",null,values);
    }
    @Test public void exactCaptureAndRevisionRequiredForVerifiedReceipt()throws Exception{
        try(CaptureQueue queue=new CaptureQueue(context)){insert(queue,"first","capture-a",1,TransferEngine.State.COMPLETE,"original-account");insert(queue,"second","capture-a",2,TransferEngine.State.QUEUED,"original-account");}
        assertEquals("COMPLETE",MainActivity.captureTransferStatus(context,"capture-a",1).getString("state"));
        assertNotEquals("COMPLETE",MainActivity.captureTransferStatus(context,"capture-a",2).getString("state"));
        assertEquals("NOT_QUEUED",MainActivity.captureTransferStatus(context,"capture-b",1).getString("state"));
        assertEquals("NOT_QUEUED",MainActivity.captureTransferStatus(context,"capture-a",3).getString("state"));
    }
    @Test public void progressRetryAuthAndLocalPauseNeverClaimVerified()throws Exception{
        UploadRecord r=record(TransferEngine.State.QUEUED);
        assertEquals("QUEUED",MainActivity.describeTransfer("capture",1,r,r.accountId,true,false).getString("state"));
        assertEquals("UPLOADING",MainActivity.describeTransfer("capture",1,r,r.accountId,true,true).getString("state"));
        assertEquals("PAUSED",MainActivity.describeTransfer("capture",1,r,r.accountId,false,true).getString("state"));
        assertEquals("PAUSED",MainActivity.describeTransfer("capture",1,r,"different-account",true,true).getString("state"));
        r.state=TransferEngine.State.RETRY;JSONObject retry=MainActivity.describeTransfer("capture",1,r,r.accountId,false,false);assertEquals("RETRY",retry.getString("state"));assertTrue(retry.getString("message").contains("Session expired"));assertTrue(retry.getString("message").contains("enable transfer"));
        r.state=TransferEngine.State.NEEDS_AUTH;assertEquals("NEEDS_AUTH",MainActivity.describeTransfer("capture",1,r,r.accountId,false,false).getString("state"));
        r.state=TransferEngine.State.BLOCKED;assertEquals("BLOCKED",MainActivity.describeTransfer("capture",1,r,r.accountId,true,false).getString("state"));
        r.state=TransferEngine.State.COMPLETE;assertEquals("COMPLETE",MainActivity.describeTransfer("capture",1,r,"different-account",false,false).getString("state"));
    }
    @Test public void activeMarkerClearsEvenWhenWorkerAttemptThrows()throws Exception{
        QueueStore store=new QueueStore(){
            public UploadRecord load(String id)throws IOException{assertTrue(TransferWorker.isActive(id));throw new IOException("fictional disk error");}
            public void save(UploadRecord r){}
            public AssignmentFolder assignmentFolder(String account,String assignment){return null;}
            public AssignmentFolder reserveAssignmentFolder(String account,String assignment,AssignmentFolder proposed){return proposed;}
        };
        assertThrows(IOException.class,()->TransferWorker.runTracked(new TransferEngine(null,store,()->true,()->"account"),"queue"));assertFalse(TransferWorker.isActive("queue"));
    }
    @Test public void accountAuthFailurePreservesVerifiedOtherAccountsAndStableIds()throws Exception{
        try(CaptureQueue queue=new CaptureQueue(context)){
            insert(queue,"waiting","capture-a",1,TransferEngine.State.QUEUED,"owner");insert(queue,"done","capture-b",1,TransferEngine.State.COMPLETE,"owner");insert(queue,"other","capture-c",1,TransferEngine.State.QUEUED,"other");
            TransferWorker.accountState(queue,"owner",TransferEngine.State.NEEDS_AUTH,"Reconnect to retry");
            assertEquals(TransferEngine.State.NEEDS_AUTH,queue.load("waiting").state);assertEquals("stable-remote-id",queue.load("waiting").fileId);assertEquals(TransferEngine.State.COMPLETE,queue.load("done").state);assertEquals(TransferEngine.State.QUEUED,queue.load("other").state);
            TransferWorker.accountState(queue,"owner",TransferEngine.State.RETRY,"Network interrupted");assertEquals(TransferEngine.State.NEEDS_AUTH,queue.load("waiting").state);
        }
    }
    @Test public void api35InsetsProtectContentWithoutAccumulationOrKeyboardDoublePadding(){
        FrameLayout content=new FrameLayout(context);WindowInsetsCompat bars=new WindowInsetsCompat.Builder().setInsets(WindowInsetsCompat.Type.systemBars(),Insets.of(0,32,0,24)).build();
        assertSame(WindowInsetsCompat.CONSUMED,MainActivity.applyContentInsets(content,bars));assertEquals(32,content.getPaddingTop());assertEquals(24,content.getPaddingBottom());
        MainActivity.applyContentInsets(content,bars);assertEquals(32,content.getPaddingTop());assertEquals(24,content.getPaddingBottom());
        WindowInsetsCompat keyboard=new WindowInsetsCompat.Builder(bars).setInsets(WindowInsetsCompat.Type.ime(),Insets.of(0,0,0,240)).setInsets(WindowInsetsCompat.Type.displayCutout(),Insets.of(18,0,0,0)).build();
        MainActivity.applyContentInsets(content,keyboard);assertEquals(18,content.getPaddingLeft());assertEquals(240,content.getPaddingBottom());
    }
}
