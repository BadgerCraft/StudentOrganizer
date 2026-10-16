package org.studentorganizer.capture.transfer;
import java.io.IOException;
public interface QueueStore {
    UploadRecord load(String queueId) throws IOException;
    /** Must atomically and durably persist before returning, or throw. Serialize workers per queue. */
    void save(UploadRecord record) throws IOException;
}
