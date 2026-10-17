package org.studentorganizer.capture.transfer;
import java.io.IOException;
public interface QueueStore {
    /** Account + stable assignment ID is the key; display names never select destinations. */
    final class AssignmentFolder {
        public final String id, parentId, name;
        public AssignmentFolder(String id,String parentId,String name){this.id=id;this.parentId=parentId;this.name=name;}
    }
    AssignmentFolder assignmentFolder(String accountId,String assignmentId) throws IOException;
    /** Atomically retain the first reservation and return the durable winner before any remote create. */
    AssignmentFolder reserveAssignmentFolder(String accountId,String assignmentId,AssignmentFolder proposed) throws IOException;
    UploadRecord load(String queueId) throws IOException;
    /** Must atomically and durably persist before returning, or throw. Serialize workers per queue. */
    void save(UploadRecord record) throws IOException;
}
