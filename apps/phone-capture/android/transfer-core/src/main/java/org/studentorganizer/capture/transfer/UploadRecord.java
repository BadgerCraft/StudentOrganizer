package org.studentorganizer.capture.transfer;

/** Durable queue snapshot. Store atomically, in app-private storage; never log it or upload it as telemetry. */
public final class UploadRecord {
    public String queueId, accountId, folderId, folderParentId, localPath, name;
    public long size;
    public String md5, sha256, fileId, sessionUrl;
    public TransferEngine.State state = TransferEngine.State.QUEUED;
    public String detail = "Waiting";
}
