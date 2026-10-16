package org.studentorganizer.capture.transfer;
import java.io.IOException;
import java.util.List;
public interface DriveGateway {
    final class Metadata {
        public String id, mimeType, md5, sha256;
        public long size = -1;
        public boolean trashed, shared, ownedByMe;
        public List<String> parents, ownerIds;
        public List<Permission> permissions;
    }
    final class Permission {
        public String id, type, role;
        public boolean deleted;
        public Permission(String id, String type, String role) { this.id=id; this.type=type; this.role=role; }
    }
    final class Failure extends IOException {
        public final int status;
        public final String reason;
        public Failure(int status, String reason) { super("Drive request failed (" + status + ")"); this.status=status; this.reason=reason; }
    }
    /** Stable Drive user permission ID, not an email/display name. */
    String identity() throws IOException;
    String rootId() throws IOException;
    String generateId() throws IOException;
    /** Null only for a genuine 404. Permissions must be complete, including inherited permissions. */
    Metadata metadata(String id) throws IOException;
    void createFolder(String id, String name) throws IOException;
    String begin(UploadRecord record) throws IOException;
    /** Resume/query server offset; throws on expired session, conflict or interruption. */
    void upload(UploadRecord record) throws IOException;
}
