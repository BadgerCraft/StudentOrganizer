package org.studentorganizer.capture.transfer;

import org.junit.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.Assert.*;

public class TransferEngineTest {
    File local; UploadRecord record; MemoryStore store; FakeDrive drive; boolean enabled; String account;
    @Before public void setup() throws Exception {
        local=File.createTempFile("fictional-batch",".zip");Files.write(local.toPath(),"fictional pupil page".getBytes());
        record=new UploadRecord();record.queueId="q";record.accountId="owner";record.folderId="folder";record.folderParentId="root";
        record.assignmentId="assignment-one";record.assignmentName="Fictional assignment";record.localPath=local.getPath();record.name="batch.zip";record.size=local.length();record.md5=TransferEngine.digest(local,"MD5");record.sha256=TransferEngine.digest(local,"SHA-256");
        enabled=true;account="owner";store=new MemoryStore();store.save(record);drive=new FakeDrive();
    }
    @After public void cleanup(){local.delete();}
    TransferEngine engine(){return new TransferEngine(drive,store,()->enabled,()->account);}
    @Test public void successKeepsOriginalAndSavedIdBeforeCreate() throws Exception {assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));assertTrue(local.exists());assertEquals("generated",store.savedIdAtBegin);}
    @Test public void timeoutAfterCommitThenRestartDoesNotDuplicate() throws Exception {
        drive.timeout=true;assertEquals(TransferEngine.State.RETRY,engine().run("q"));assertEquals(1,drive.creates);
        drive.timeout=false;assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));assertEquals(1,drive.creates);assertEquals(1,drive.generated);
    }
    @Test public void failedIdPersistenceNeverCreates() throws Exception {
        store.failId=true;
        try{engine().run("q");fail("save must fail");}catch(IOException expected){}
        assertEquals(0,drive.creates);
    }
    @Test public void checksumMismatchBlocks() throws Exception {drive.badChecksum=true;assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));}
    @Test public void unknownSha256NeverCompletes() throws Exception {drive.noSha=true;assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));}
    @Test public void sharedFolderNeverUploads() throws Exception {drive.folder.shared=true;assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));assertEquals(0,drive.creates);}
    @Test public void extraInheritedReaderBlocks() throws Exception {drive.folder.permissions.add(new DriveGateway.Permission("reader","user","reader"));assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));assertEquals(0,drive.creates);}
    @Test public void movedFolderBlocks() throws Exception {drive.folder.parents=List.of("shared-parent");assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));}
    @Test public void wrongRemoteAccountBlocks() throws Exception {drive.identity="different";assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));assertEquals(0,drive.creates);}
    @Test public void wrongSelectedAccountPausesWithoutNetwork() throws Exception {account="different";assertEquals(TransferEngine.State.PAUSED,engine().run("q"));assertEquals(0,drive.calls);}
    @Test public void optOutBeforeAttemptNeverNetworks() throws Exception {enabled=false;assertEquals(TransferEngine.State.PAUSED,engine().run("q"));assertEquals(0,drive.calls);}
    @Test public void optOutAfterUploadNeverMarksComplete() throws Exception {drive.disableAfterUpload=true;assertEquals(TransferEngine.State.PAUSED,engine().run("q"));assertTrue(local.exists());}
    @Test public void tokenExpiryNeedsReconnect() throws Exception {drive.failure=new DriveGateway.Failure(401,"authError");assertEquals(TransferEngine.State.NEEDS_AUTH,engine().run("q"));}
    @Test public void quotaBlocksAndRateLimitRetries() throws Exception {drive.failure=new DriveGateway.Failure(403,"storageQuotaExceeded");assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));drive.failure=new DriveGateway.Failure(429,"rateLimitExceeded");assertEquals(TransferEngine.State.RETRY,engine().run("q"));}
    @Test public void conflictVerifiesSameFile() throws Exception {drive.conflict=true;assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));assertEquals(1,drive.generated);}
    @Test public void conflictWithWrongParentBlocks() throws Exception {drive.conflict=true;drive.wrongParent=true;assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));}
    @Test public void expiredSessionRetainsId() throws Exception {
        drive.failure=new DriveGateway.Failure(410,"gone");assertEquals(TransferEngine.State.RETRY,engine().run("q"));assertNull(store.load("q").sessionUrl);
        drive.failure=null;assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));assertEquals(1,drive.generated);
    }
    @Test public void changedLocalOriginalNeverUploads() throws Exception {Files.write(local.toPath(),"changed fictional bytes".getBytes());assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));assertEquals(0,drive.creates);}
    @Test public void sharedUploadedFileNeverCompletes() throws Exception {drive.shareFile=true;assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));}
    @Test public void folderSharedDuringUploadNeverCompletes() throws Exception {drive.shareFolderAfterUpload=true;assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));}
    @Test public void corruptQueueBlocksWithoutNetwork() throws Exception {record.localPath=null;store.save(record);assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));assertEquals(0,drive.calls);}
    @Test public void assignmentFolderIdSavedBeforeCreateAndReusedAfterTimeout()throws Exception {
        record.folderId=null;record.folderParentId=null;store.save(record);drive.folder=null;drive.folderTimeout=true;
        assertEquals(TransferEngine.State.RETRY,engine().run("q"));
        String saved=store.load("q").folderId;assertNotNull(saved);assertEquals(saved,drive.savedFolderAtCreate);assertEquals("Fictional assignment",drive.createdFolderName);
        drive.folderTimeout=false;assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));assertEquals(saved,store.load("q").folderId);assertEquals(1,drive.folderCreates);
    }
    @Test public void folderPersistenceFailureNeverCreatesRemoteFolder()throws Exception {
        record.folderId=null;record.folderParentId=null;store.save(record);drive.folder=null;store.failFolder=true;
        assertThrows(IOException.class,()->engine().run("q"));assertEquals(0,drive.folderCreates);
    }
    @Test public void legacyQueueRecordWithoutAssignmentNeverNetworks()throws Exception {
        record.assignmentId=null;record.assignmentName=null;store.save(record);assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));assertEquals(0,drive.calls);
    }
    private UploadRecord supplement(String id){UploadRecord next=store.gson.fromJson(store.gson.toJson(record),UploadRecord.class);next.queueId=id;next.folderId=null;next.folderParentId=null;next.fileId=null;next.sessionUrl=null;next.state=TransferEngine.State.QUEUED;return next;}
    @Test public void lateSupplementReusesAccountAssignmentFolderAndDistinctFileIds()throws Exception{
        record.folderId=null;record.folderParentId=null;store.save(record);drive.folder=null;
        assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));String folder=store.load("q").folderId,file=store.load("q").fileId;
        UploadRecord late=supplement("late");late.assignmentName="Renamed display hint";store.save(late);
        assertEquals(TransferEngine.State.COMPLETE,engine().run("late"));assertEquals(folder,store.load("late").folderId);assertNotEquals(file,store.load("late").fileId);assertEquals(1,drive.folderCreates);
    }
    @Test public void supplementRechecksFolderPrivacyAndNeverReplacesUnsafeDestination()throws Exception{
        assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));store.save(supplement("late"));drive.folder.permissions.add(new DriveGateway.Permission("reader","user","reader"));
        assertEquals(TransferEngine.State.BLOCKED,engine().run("late"));assertEquals(1,drive.creates);assertEquals("folder",store.assignmentFolder("owner","assignment-one").id);assertEquals(0,drive.folderCreates);
    }
    @Test public void sameNameDifferentAssignmentGetsDifferentReservation()throws Exception{
        assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));UploadRecord other=supplement("other");other.assignmentId="different-assignment";store.save(other);
        assertEquals(TransferEngine.State.COMPLETE,engine().run("other"));assertNotEquals(store.load("q").folderId,store.load("other").folderId);assertEquals(record.assignmentName,drive.createdFolderName);
    }
    @Test public void reservationDiskFailureNeverCreatesFolderOrUploadAndRetryUsesStableReservation()throws Exception{
        record.folderId=null;record.folderParentId=null;store.save(record);drive.folder=null;store.failReservation=true;
        assertEquals(TransferEngine.State.RETRY,engine().run("q"));assertEquals(0,drive.folderCreates);assertEquals(0,drive.creates);
        store.failReservation=false;drive.folderTimeout=true;assertEquals(TransferEngine.State.RETRY,engine().run("q"));String id=store.assignmentFolder("owner","assignment-one").id;
        store.save(supplement("late"));drive.folderTimeout=false;assertEquals(TransferEngine.State.COMPLETE,engine().run("late"));assertEquals(id,store.load("late").folderId);assertEquals(1,drive.folderCreates);
    }
    @Test public void sameAssignmentInDifferentAccountNeverReusesFirstAccountFolder()throws Exception{
        assertEquals(TransferEngine.State.COMPLETE,engine().run("q"));UploadRecord other=supplement("other-account");other.accountId="other-owner";store.save(other);account="other-owner";drive=new FakeDrive();drive.identity="other-owner";drive.folder=null;
        assertEquals(TransferEngine.State.COMPLETE,engine().run("other-account"));assertEquals(1,drive.folderCreates);assertEquals("folder",store.assignmentFolder("owner","assignment-one").id);assertNotEquals("folder",store.assignmentFolder("other-owner","assignment-one").id);
    }
    @Test public void conflictingOldPackageDestinationIsNeverSilentlyReparented()throws Exception{
        store.reserveAssignmentFolder("owner","assignment-one",new QueueStore.AssignmentFolder("different-folder","root","Original assignment"));
        assertEquals(TransferEngine.State.BLOCKED,engine().run("q"));assertEquals(0,drive.creates);assertEquals("folder",store.load("q").folderId);
    }
    class MemoryStore implements QueueStore {
        String savedIdAtBegin;boolean failId,failFolder,failReservation;
        Map<String,String> records=new HashMap<>();Map<String,AssignmentFolder> folders=new HashMap<>();
        com.google.gson.Gson gson=new com.google.gson.Gson();
        public AssignmentFolder assignmentFolder(String account,String assignment){return folders.get(account+"/"+assignment);}
        public synchronized AssignmentFolder reserveAssignmentFolder(String account,String assignment,AssignmentFolder proposed)throws IOException{if(failReservation)throw new IOException("disk full saving assignment folder");return folders.computeIfAbsent(account+"/"+assignment,key->proposed);}
        public UploadRecord load(String id){return gson.fromJson(records.get(id),UploadRecord.class);}
        public void save(UploadRecord r)throws IOException{if(failFolder&&r.folderId!=null)throw new IOException("disk full saving folder");if(failId&&r.fileId!=null)throw new IOException("disk full");records.put(r.queueId,gson.toJson(r));}
    }
    class FakeDrive implements DriveGateway {
        Metadata folder=meta("folder","application/vnd.google-apps.folder","root"),file;
        int calls,creates,generated,folderCreates;String savedFolderAtCreate,createdFolderName;boolean folderTimeout;boolean timeout,badChecksum,noSha,disableAfterUpload,conflict,wrongParent,shareFile,shareFolderAfterUpload;
        String identity="owner";Failure failure;
        public String identity(){calls++;return identity;}
        public String rootId(){calls++;return "root";}
        public String generateId(){calls++;generated++;return generated==1?"generated":"generated-"+generated;}
        public Metadata metadata(String id){calls++;return folder!=null&&id.equals(folder.id)?folder:file!=null&&id.equals(file.id)?file:null;}
        public void createFolder(String id,String name)throws IOException{folderCreates++;savedFolderAtCreate=store.load("q").folderId;createdFolderName=name;folder=meta(id,"application/vnd.google-apps.folder","root");if(folderTimeout)throw new IOException("timeout after folder creation");}
        public String begin(UploadRecord r)throws IOException {
            calls++;creates++;store.savedIdAtBegin=store.load(r.queueId).fileId;
            if(conflict){commit(r);throw new Failure(409,"conflict");}return "session";
        }
        public void upload(UploadRecord r)throws IOException {
            calls++;if(failure!=null)throw failure;commit(r);if(disableAfterUpload)enabled=false;if(timeout)throw new IOException("timeout after commit");
        }
        void commit(UploadRecord r){file=meta(r.fileId,"application/zip",wrongParent?"other-folder":r.folderId);file.size=r.size;file.md5=badChecksum?"wrong":r.md5;file.sha256=noSha?null:r.sha256;file.shared=shareFile;if(shareFolderAfterUpload)folder.shared=true;}
        Metadata meta(String id,String mime,String parent){Metadata m=new Metadata();m.id=id;m.mimeType=mime;m.parents=List.of(parent);String owner=identity==null?"owner":identity;m.ownerIds=List.of(owner);m.permissions=new ArrayList<>(List.of(new Permission(owner,"user","owner")));m.ownedByMe=true;return m;}
    }
}
