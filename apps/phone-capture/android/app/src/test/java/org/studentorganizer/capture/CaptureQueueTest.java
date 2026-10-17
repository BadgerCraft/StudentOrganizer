package org.studentorganizer.capture;
import android.content.Context;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.studentorganizer.capture.transfer.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class CaptureQueueTest {
    Context context;
    @Before public void setup(){context=RuntimeEnvironment.getApplication();context.deleteDatabase("capture-transfer.db");}
    // Robolectric ShadowLinux cannot open directories. Use the host's actual directory fsync
    // for queue tests; Android Os.open/fsync still requires physical-device verification.
    private CaptureQueue queue(){return new CaptureQueue(context, directory -> {try(java.nio.channels.FileChannel channel=java.nio.channels.FileChannel.open(directory.toPath(),java.nio.file.StandardOpenOption.READ)){channel.force(true);}});}
    @Test public void directorySyncFailureNeverPublishesQueueRow()throws Exception{try(CaptureQueue q=new CaptureQueue(context,directory->{throw new IOException("fictional sync failure");})){assertThrows(IOException.class,()->q.enqueue(fixture("A"),"fictional-batch",1,"account-one"));assertTrue(q.all().isEmpty());}}
    private byte[] fixture(String label)throws Exception{return fixture(label,"fictional-batch");}
    private byte[] fixture(String label,String batch)throws Exception{
        byte[] photo="fictional image bytes".getBytes(StandardCharsets.UTF_8);
        JSONObject page=new JSONObject().put("path","pages/001.png").put("order",1).put("studentId",JSONObject.NULL).put("matchStatus","unmatched").put("labelHint",label).put("byteLength",photo.length).put("sha256",CaptureQueue.digest(photo,"SHA-256"));
        JSONObject manifest=new JSONObject().put("format","studentorganizer-capture").put("version",1).put("fictional",true).put("requiresExplicitDesktopMatching",true).put("batchId",batch).put("revision",1).put("pages",new JSONArray().put(page));
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream zip=new ZipOutputStream(bytes)){zip.putNextEntry(new ZipEntry("pages/001.png"));zip.write(photo);zip.closeEntry();zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(manifest.toString().getBytes(StandardCharsets.UTF_8));zip.closeEntry();}return bytes.toByteArray();
    }
    @Test public void unapprovedBuildCannotEnableTransfers(){
        assertFalse(BuildConfig.CAPTURE_DRIVE_SETUP_APPROVED);
        context.getSharedPreferences("private-drive",Context.MODE_PRIVATE).edit().putBoolean("enabled",true).putString("accountId","fictional-account").commit();
        assertFalse(TransferWorker.enabled(context));
    }
    @Test public void retainedBytesAndAccountSurviveDatabaseReopen()throws Exception{
        byte[] fixture=fixture("Fictional A");String id;try(CaptureQueue q=queue()){id=q.enqueue(fixture,"fictional-batch",1,"account-one");}
        try(CaptureQueue q=queue()){UploadRecord record=q.load(id);assertEquals("account-one",record.accountId);assertArrayEquals(fixture,java.nio.file.Files.readAllBytes(new File(record.localPath).toPath()));assertEquals(id,q.enqueue(fixture,"fictional-batch",1,"account-one"));assertEquals(1,q.all().size());}
    }
    @Test public void duplicateRevisionCannotChangeBytesOrAccount()throws Exception{
        try(CaptureQueue q=queue()){byte[] fixture=fixture("Fictional A");q.enqueue(fixture,"fictional-batch",1,"account-one");assertThrows(IOException.class,()->q.enqueue(fixture,"fictional-batch",1,"account-two"));assertThrows(IOException.class,()->q.enqueue(fixture("Fictional B"),"fictional-batch",1,"account-one"));assertEquals(1,q.all().size());}
    }
    @Test public void mismatchedManifestAndEmptyLabelsNeverEnterQueue()throws Exception{
        try(CaptureQueue q=queue()){assertThrows(IOException.class,()->q.enqueue(fixture("A"),"other-batch",1,"account-one"));assertThrows(IOException.class,()->q.enqueue(fixture(""),"fictional-batch",1,"account-one"));assertTrue(q.all().isEmpty());}
    }
    @Test public void retryReloadsWorkerIdsInsteadOfOverwritingStaleUiSnapshot()throws Exception{
        try(CaptureQueue ui=queue();CaptureQueue worker=queue()){
            String id=ui.enqueue(fixture("A"),"fictional-batch",1,"account-one");
            UploadRecord staleUi=ui.all().get(0);assertNull(staleUi.fileId);
            UploadRecord active=worker.load(id);active.fileId="durable-remote-id";active.sessionUrl="fictional-session";active.state=TransferEngine.State.RETRY;worker.save(active);
            ui.retryForAccount("account-one");UploadRecord latest=worker.load(id);
            assertEquals("durable-remote-id",latest.fileId);assertEquals("fictional-session",latest.sessionUrl);assertEquals(TransferEngine.State.QUEUED,latest.state);
            latest.state=TransferEngine.State.COMPLETE;worker.save(latest);ui.retryForAccount("account-one");assertEquals(TransferEngine.State.COMPLETE,worker.load(id).state);
        }
    }
    @Test public void retryFailureRollsBackEarlierRowsAndRetainsRemoteIds()throws Exception{
        try(CaptureQueue q=queue()){
            String first=q.enqueue(fixture("A"),"fictional-batch",1,"account-one");String second=q.enqueue(fixture("B","fictional-other"),"fictional-other",1,"account-one");
            for(String id:new String[]{first,second}){UploadRecord record=q.load(id);record.state=TransferEngine.State.BLOCKED;record.fileId="remote-"+id;q.save(record);}
            q.getWritableDatabase().execSQL("CREATE TRIGGER fictional_full_disk BEFORE UPDATE ON queue WHEN OLD.capture='fictional-other' BEGIN SELECT RAISE(ABORT, 'fictional storage failure'); END");
            assertThrows(android.database.sqlite.SQLiteException.class,()->q.retryForAccount("account-one"));
            for(String id:new String[]{first,second}){assertEquals(TransferEngine.State.BLOCKED,q.load(id).state);assertEquals("remote-"+id,q.load(id).fileId);}
        }
    }
    @Test public void retryDoesNotChangeAnotherAccountsRecord()throws Exception{
        try(CaptureQueue q=queue()){String id=q.enqueue(fixture("A"),"fictional-batch",1,"account-one");UploadRecord r=q.load(id);r.state=TransferEngine.State.BLOCKED;q.save(r);q.retryForAccount("account-two");assertEquals(TransferEngine.State.BLOCKED,q.load(id).state);}
    }
    @Test public void completedStatusAndRemoteIdSurviveRestart()throws Exception{
        String id;try(CaptureQueue q=queue()){id=q.enqueue(fixture("A"),"fictional-batch",1,"account-one");UploadRecord r=q.load(id);r.fileId="stable-remote-id";r.state=TransferEngine.State.COMPLETE;q.save(r);}
        try(CaptureQueue q=queue()){assertEquals("stable-remote-id",q.load(id).fileId);assertEquals(TransferEngine.State.COMPLETE,q.load(id).state);}
    }
}
