package org.studentorganizer.capture.transfer;

import java.io.*;
import java.security.*;
import java.util.*;
import java.util.function.*;

/** One serialized queue attempt. No deletion, model calls, permission changes or token persistence. */
public final class TransferEngine {
    public enum State { QUEUED, RETRY, NEEDS_AUTH, BLOCKED, PAUSED, COMPLETE }
    private final DriveGateway drive;
    private final QueueStore store;
    private final BooleanSupplier enabled;
    private final Supplier<String> account;
    public TransferEngine(DriveGateway drive, QueueStore store, BooleanSupplier enabled, Supplier<String> account) {
        this.drive=drive; this.store=store; this.enabled=enabled; this.account=account;
    }
    public State run(String queueId) throws IOException {
        UploadRecord r=store.load(queueId);
        if (r == null) throw new IOException("Missing queue item");
        if (r.state == State.COMPLETE) return r.state;
        try {
            if (blank(r.localPath) || blank(r.accountId) || blank(r.assignmentId) || blank(r.assignmentName) || blank(r.name)
                || r.size<=0 || r.md5==null || !r.md5.matches("[A-Fa-f0-9]{32}") || r.sha256==null || !r.sha256.matches("[A-Fa-f0-9]{64}"))
                throw new Unsafe("Queue snapshot is incomplete; original retained");
            guard(r);
            if (!Objects.equals(r.accountId, drive.identity())) return finish(r,State.BLOCKED,"Google account changed; reconnect the original account");
            guard(r);
            verifyLocal(r);
            ensureFolder(r);
            checkFolder(r);
            if (r.fileId == null || r.fileId.isEmpty()) {
                guard(r); r.fileId=drive.generateId();
                if (r.fileId == null || r.fileId.isEmpty()) throw new IOException("No upload ID returned");
                store.save(r); // Critical: no file create can occur before this durable save.
            }
            guard(r);
            DriveGateway.Metadata existing=drive.metadata(r.fileId);
            if (existing != null) return verifyComplete(r,existing);
            if (r.sessionUrl == null) {
                guard(r); r.sessionUrl=drive.begin(r); store.save(r);
            }
            checkFolder(r);
            guard(r); drive.upload(r);
            guard(r); return verifyComplete(r,drive.metadata(r.fileId));
        } catch (Stopped e) { return finish(r,State.PAUSED,"Transfer is off or account selection changed");
        } catch (Unsafe e) { return finish(r,State.BLOCKED,e.getMessage());
        } catch (DriveGateway.Failure e) {
            if (e.status == 409) {
                try { guard(r); return verifyComplete(r,drive.metadata(r.fileId)); }
                catch (Stopped stopped) { return finish(r,State.PAUSED,"Transfer is off"); }
                catch (Unsafe unsafe) { return finish(r,State.BLOCKED,unsafe.getMessage()); }
                catch (IOException unavailable) { return finish(r,State.RETRY,"Could not verify existing upload; original retained"); }
            }
            if (e.status == 401) return finish(r,State.NEEDS_AUTH,"Reconnect Google in the app");
            if (e.status == 404 || e.status == 410) { r.sessionUrl=null; return finish(r,State.RETRY,"Session expired; retry will use the same file ID"); }
            if (e.status == 429 || e.status >= 500 || (e.status == 403 && ("rateLimitExceeded".equals(e.reason) || "userRateLimitExceeded".equals(e.reason))))
                return finish(r,State.RETRY,"Google temporarily unavailable; original retained");
            return finish(r,State.BLOCKED,"Google denied transfer; check permission or storage quota");
        } catch (IOException e) {
            if (!enabled.getAsBoolean() || !Objects.equals(r.accountId,account.get())) return finish(r,State.PAUSED,"Transfer is off or account selection changed");
            return finish(r,State.RETRY,"Transfer interrupted; original retained for retry");
        }
    }
    private State verifyComplete(UploadRecord r, DriveGateway.Metadata m) throws IOException {
        guard(r); checkFolder(r);
        if (m == null) return finish(r,State.RETRY,"Waiting for uploaded file verification");
        if (!privateOwned(m,r.accountId) || !Objects.equals(m.id,r.fileId) || !"application/zip".equals(m.mimeType)
            || m.parents == null || m.parents.size()!=1 || !m.parents.contains(r.folderId)
            || m.size != r.size || !same(r.md5,m.md5) || !same(r.sha256,m.sha256))
            throw new Unsafe("Uploaded file differs or is shared/moved; original retained");
        guard(r); return finish(r,State.COMPLETE,"Verified private Drive copy; local original retained");
    }
    private static boolean blank(String value) { return value==null || value.isEmpty(); }
    private static boolean same(String a,String b) { return a!=null && b!=null && a.equalsIgnoreCase(b); }
    public static boolean privateOwned(DriveGateway.Metadata m,String accountId) {
        if (m==null || m.trashed || m.shared || !m.ownedByMe || m.ownerIds==null || m.ownerIds.size()!=1 || !m.ownerIds.contains(accountId)
            || m.permissions==null || m.permissions.size()!=1) return false;
        DriveGateway.Permission p=m.permissions.get(0);
        return !p.deleted && "user".equals(p.type) && "owner".equals(p.role) && Objects.equals(accountId,p.id);
    }
    /** Folder IDs are committed before creation; retries never search or choose by name. */
    private void ensureFolder(UploadRecord r) throws IOException {
        guard(r); String root=drive.rootId();
        if (blank(r.folderId)) {
            guard(r); r.folderId=drive.generateId(); r.folderParentId=root;
            if (blank(r.folderId)) throw new IOException("No folder ID returned");
            store.save(r);
        }
        if (!Objects.equals(r.folderParentId,root)) throw new Unsafe("Destination is no longer in My Drive root");
        guard(r);
        if (drive.metadata(r.folderId)==null) {
            guard(r);
            try { drive.createFolder(r.folderId,r.assignmentName); }
            catch (DriveGateway.Failure failure) { if(failure.status!=409)throw failure; }
        }
        checkFolder(r);
    }
    private void checkFolder(UploadRecord r) throws IOException {
        guard(r); DriveGateway.Metadata f=drive.metadata(r.folderId);
        if (!privateOwned(f,r.accountId) || !Objects.equals(f.id,r.folderId) || !"application/vnd.google-apps.folder".equals(f.mimeType)
            || f.parents==null || f.parents.size()!=1 || !f.parents.contains(r.folderParentId))
            throw new Unsafe("Destination privacy or location changed; transfer paused");
    }
    private void verifyLocal(UploadRecord r) throws IOException {
        File f=new File(r.localPath);
        if (!f.isFile() || f.length()!=r.size || !same(r.md5,digest(f,"MD5")) || !same(r.sha256,digest(f,"SHA-256")))
            throw new Unsafe("Local export changed or is missing; create a new batch");
    }
    public static String digest(File file,String algorithm) throws IOException {
        try {
            MessageDigest digest=MessageDigest.getInstance(algorithm);
            try(InputStream in=new FileInputStream(file)) { byte[] b=new byte[65536]; int n; while((n=in.read(b))!=-1) digest.update(b,0,n); }
            StringBuilder out=new StringBuilder(); for(byte b:digest.digest()) out.append(String.format(Locale.ROOT,"%02x",b & 255)); return out.toString();
        } catch(NoSuchAlgorithmException e) { throw new IOException("Checksum unavailable",e); }
    }
    private void guard(UploadRecord r) throws Stopped {
        if (!enabled.getAsBoolean() || !Objects.equals(r.accountId,account.get())) throw new Stopped();
    }
    private State finish(UploadRecord r,State state,String detail) throws IOException { r.state=state; r.detail=detail; store.save(r); return state; }
    private static final class Stopped extends IOException {}
    private static final class Unsafe extends IOException { Unsafe(String message){super(message);} }
}
