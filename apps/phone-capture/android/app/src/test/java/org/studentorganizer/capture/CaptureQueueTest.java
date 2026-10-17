package org.studentorganizer.capture;
import android.content.Context;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.studentorganizer.capture.transfer.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
import static org.junit.Assert.*;
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class CaptureQueueTest {
    Context context;
    @Before public void setup(){context=RuntimeEnvironment.getApplication();context.deleteDatabase("capture-transfer.db");}
    // Robolectric ShadowLinux cannot open directories. Use the host's actual directory fsync
    // for queue tests; Android Os.open/fsync still requires physical-device verification.
    private CaptureQueue queue(){return new CaptureQueue(context, directory -> {try(java.nio.channels.FileChannel channel=java.nio.channels.FileChannel.open(directory.toPath(),java.nio.file.StandardOpenOption.READ)){channel.force(true);}});}
    @Test public void directorySyncFailureNeverPublishesQueueRow()throws Exception{try(CaptureQueue q=new CaptureQueue(context,directory->{throw new IOException("fictional sync failure");})){assertThrows(IOException.class,()->q.enqueue(fixture("A"),"fictional-batch",1,"account-one"));assertTrue(q.all().isEmpty());}}
    private byte[] fixture(String label)throws Exception{return fixture(label,"fictional-batch");}
    private byte[] fixture(String label,String batch)throws Exception{return fixture(label,batch,2,true);}
    private byte[] fixture(String label,String batch,int version,boolean completed)throws Exception{
        android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(2,2,android.graphics.Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream image=new ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,image);bitmap.recycle();byte[] photo=image.toByteArray();
        JSONObject crop=new JSONObject().put("x",0).put("y",0).put("width",1).put("height",1);
        JSONObject page=new JSONObject().put("id","page-one").put("path","pages/student-one/page-one.png").put("order",0).put("mime","image/png").put("edits",new JSONObject().put("rotation",90).put("crop",crop)).put("byteLength",photo.length).put("sha256",CaptureQueue.digest(photo,"SHA-256"));
        JSONObject submission=new JSONObject().put("id","student-one").put("label",label).put("pages",new JSONArray().put(page));
        JSONObject manifest=new JSONObject().put("format","studentorganizer-capture").put("version",version).put("completed",completed).put("assignmentName","Fictional fractions").put("assignmentId","assignment-one").put("packageId",batch).put("revision",1).put("submissions",new JSONArray().put(submission));
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream zip=new ZipOutputStream(bytes)){entry(zip,"pages/student-one/page-one.png",photo);entry(zip,"manifest.json",manifest.toString().getBytes(StandardCharsets.UTF_8));}return bytes.toByteArray();
    }
    private void entry(ZipOutputStream zip,String path,byte[] bytes)throws Exception{CRC32 crc=new CRC32();crc.update(bytes);ZipEntry entry=new ZipEntry(path);entry.setMethod(ZipEntry.STORED);entry.setSize(bytes.length);entry.setCompressedSize(bytes.length);entry.setCrc(crc.getValue());zip.putNextEntry(entry);zip.write(bytes);zip.closeEntry();}
    @Test public void fileEnqueueRetainsAssignmentMetadata()throws Exception {
        File file=File.createTempFile("fictional-completed-",".zip",context.getCacheDir());
        try {java.nio.file.Files.write(file.toPath(),fixture("Fictional A"));try(CaptureQueue q=queue()){UploadRecord r=q.load(q.enqueue(file,"fictional-batch",1,"account-one"));assertEquals("assignment-one",r.assignmentId);assertEquals("Fictional fractions",r.assignmentName);}}
        finally{file.delete();}
    }
    @Test public void corruptZipHeaderAndTrailingBytesNeverEnterQueue()throws Exception{
        byte[] good=fixture("A"),bad=good.clone();bad[6]=1;byte[] trailing=java.util.Arrays.copyOf(good,good.length+1);
        try(CaptureQueue q=queue()){assertThrows(IOException.class,()->q.enqueue(bad,"fictional-batch",1,"account-one"));assertThrows(IOException.class,()->q.enqueue(trailing,"fictional-batch",1,"account-one"));assertTrue(q.all().isEmpty());}
    }
    @Test public void legacyAndUnfinishedPackagesNeverEnterQueue()throws Exception{
        try(CaptureQueue q=queue()){assertThrows(IOException.class,()->q.enqueue(fixture("A","fictional-batch",1,true),"fictional-batch",1,"account-one"));assertThrows(IOException.class,()->q.enqueue(fixture("A","fictional-batch",2,false),"fictional-batch",1,"account-one"));assertTrue(q.all().isEmpty());}
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
    @Test public void explicitDeleteRemovesOwnedQueueAndSyncFailureOrphanOnly()throws Exception{
        try(CaptureQueue q=new CaptureQueue(context,directory->{throw new IOException("fictional sync failure");})){assertThrows(IOException.class,()->q.enqueue(fixture("A"),"fictional-batch",1,"account-one"));}
        try(CaptureQueue q=queue()){
            String other=q.enqueue(fixture("B","fictional-other"),"fictional-other",1,"account-one");File retained=new File(q.load(other).localPath);
            q.deleteCapture("fictional-batch");assertTrue(retained.isFile());assertEquals(1,q.all().size());
            File[] files=new File(context.getFilesDir(),"capture-queue").listFiles();assertNotNull(files);for(File file:files)assertFalse(file.getName().startsWith("fictional-batch-"));
            q.deleteCapture("fictional-other");assertFalse(retained.exists());assertTrue(q.all().isEmpty());
        }
    }

    @Test public void wholeClassFortyTimesTenPagesRetainsRepeatedImagesForDifferentStudents()throws Exception{
        android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(2,2,android.graphics.Bitmap.Config.ARGB_8888);ByteArrayOutputStream image=new ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,image);bitmap.recycle();byte[] photo=image.toByteArray();
        JSONArray submissions=new JSONArray();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        try(ZipOutputStream zip=new ZipOutputStream(bytes)){
            for(int student=0;student<40;student++){JSONArray pages=new JSONArray();String sid="student-"+student;
                for(int number=0;number<10;number++){String pid="page-"+student+"-"+number,path="pages/"+sid+"/"+pid+".png";entry(zip,path,photo);
                    pages.put(new JSONObject().put("id",pid).put("path",path).put("order",number).put("mime","image/png").put("byteLength",photo.length).put("sha256",CaptureQueue.digest(photo,"SHA-256")).put("edits",new JSONObject().put("rotation",0).put("crop",new JSONObject().put("x",0).put("y",0).put("width",1).put("height",1))));}
                submissions.put(new JSONObject().put("id",sid).put("label","Duplicate fictional name").put("pages",pages));}
            JSONObject manifest=new JSONObject().put("format","studentorganizer-capture").put("version",2).put("completed",true).put("assignmentName","Whole fictional class").put("assignmentId","assignment-class").put("packageId","class-package").put("revision",1).put("submissions",submissions);
            entry(zip,"manifest.json",manifest.toString().getBytes(StandardCharsets.UTF_8));
        }
        try(CaptureQueue q=queue()){String id=q.enqueue(bytes.toByteArray(),"class-package",1,"account-one");try(ZipFile retained=new ZipFile(q.load(id).localPath)){assertEquals(401,retained.size());}}
    }

    @Test public void assignmentFolderReservationSurvivesRestartAndCaptureDeletionWithoutCrossAccountReuse()throws Exception{
        try(CaptureQueue q=queue()){
            q.enqueue(fixture("A"),"fictional-batch",1,"account-one");q.enqueue(fixture("B","supplement"),"supplement",1,"account-one");
            q.reserveAssignmentFolder("account-one","assignment-one",new QueueStore.AssignmentFolder("stable-folder","root","Same assignment name"));
            assertEquals("stable-folder",q.reserveAssignmentFolder("account-one","assignment-one",new QueueStore.AssignmentFolder("loser-folder","root","Renamed hint")).id);
            assertEquals("second-folder",q.reserveAssignmentFolder("account-two","assignment-one",new QueueStore.AssignmentFolder("second-folder","root-two","Same assignment name")).id);
            assertEquals("different-folder",q.reserveAssignmentFolder("account-one","assignment-two",new QueueStore.AssignmentFolder("different-folder","root","Same assignment name")).id);
            q.deleteCapture("fictional-batch");assertEquals(1,q.all().size());assertTrue(new File(q.all().get(0).localPath).exists());
        }
        try(CaptureQueue q=queue()){assertEquals("stable-folder",q.assignmentFolder("account-one","assignment-one").id);assertEquals("second-folder",q.assignmentFolder("account-two","assignment-one").id);assertEquals("different-folder",q.assignmentFolder("account-one","assignment-two").id);assertEquals(1,q.all().size());}
    }
    @Test public void concurrentQueueInstancesSelectOneDurableFolderBeforeAnyCreate()throws Exception{
        try(CaptureQueue first=queue();CaptureQueue second=queue()){
            first.getWritableDatabase();second.getWritableDatabase();java.util.concurrent.ExecutorService pool=java.util.concurrent.Executors.newFixedThreadPool(2);java.util.concurrent.CountDownLatch start=new java.util.concurrent.CountDownLatch(1);
            try{java.util.concurrent.Future<QueueStore.AssignmentFolder> a=pool.submit(()->{start.await();return first.reserveAssignmentFolder("account","assignment",new QueueStore.AssignmentFolder("candidate-a","root","Fictional"));});java.util.concurrent.Future<QueueStore.AssignmentFolder> b=pool.submit(()->{start.await();return second.reserveAssignmentFolder("account","assignment",new QueueStore.AssignmentFolder("candidate-b","root","Fictional"));});start.countDown();assertEquals(a.get(10,java.util.concurrent.TimeUnit.SECONDS).id,b.get(10,java.util.concurrent.TimeUnit.SECONDS).id);}
            finally{pool.shutdownNow();}
        }
    }
    @Test public void failedFolderInsertDoesNotReportUnsavedCandidateAndCanRetry()throws Exception{
        try(CaptureQueue q=queue()){
            q.getWritableDatabase().execSQL("CREATE TRIGGER fictional_folder_disk_full BEFORE INSERT ON assignment_folders BEGIN SELECT RAISE(ABORT, 'fictional disk full'); END");
            assertThrows(IOException.class,()->q.reserveAssignmentFolder("account","assignment",new QueueStore.AssignmentFolder("candidate","root","Fictional")));assertNull(q.assignmentFolder("account","assignment"));
            q.getWritableDatabase().execSQL("DROP TRIGGER fictional_folder_disk_full");assertEquals("candidate",q.reserveAssignmentFolder("account","assignment",new QueueStore.AssignmentFolder("candidate","root","Fictional")).id);
        }
    }
    @Test public void versionOneMigrationPreservesEarliestDestinationWithoutRewritingQueue()throws Exception{
        try(CaptureQueue q=queue()){
            String first=q.enqueue(fixture("A"),"fictional-batch",1,"account-one"),second=q.enqueue(fixture("B","supplement"),"supplement",1,"account-one");
            UploadRecord one=q.load(first);one.folderId="earliest-folder";one.folderParentId="root";q.save(one);UploadRecord two=q.load(second);two.folderId="old-separate-folder";two.folderParentId="root";q.save(two);
            q.getWritableDatabase().execSQL("DROP TABLE assignment_folders");q.getWritableDatabase().setVersion(1);
        }
        try(CaptureQueue q=queue()){assertEquals("earliest-folder",q.assignmentFolder("account-one","assignment-one").id);assertEquals(2,q.all().size());assertEquals("old-separate-folder",q.all().get(1).folderId);for(UploadRecord row:q.all())assertTrue(new File(row.localPath).exists());}
    }

}
