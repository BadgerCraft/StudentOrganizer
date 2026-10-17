package org.studentorganizer.capture.transfer;

import com.google.gson.*;
import org.junit.Test;
import java.io.*;
import java.net.URI;
import java.nio.file.Files;
import java.util.*;
import static org.junit.Assert.*;

/** Exercises real Drive request construction with fictional in-memory HTTP responses only. */
public class AssignmentFolderTransportTest {
    static final class Store implements QueueStore {
        final Map<String,UploadRecord> records=new HashMap<>();
        final Map<String,AssignmentFolder> folders=new HashMap<>();
        final Gson gson=new Gson();
        public UploadRecord load(String id){return gson.fromJson(gson.toJson(records.get(id)),UploadRecord.class);}
        public void save(UploadRecord r){records.put(r.queueId,gson.fromJson(gson.toJson(r),UploadRecord.class));}
        public AssignmentFolder assignmentFolder(String account,String assignment){return folders.get(account+"/"+assignment);}
        public AssignmentFolder reserveAssignmentFolder(String account,String assignment,AssignmentFolder proposed){return folders.computeIfAbsent(account+"/"+assignment,key->proposed);}
    }
    static final class Transport implements HttpDriveGateway.Transport {
        final Store store;final Map<String,JsonObject> remote=new HashMap<>();final Map<String,UploadRecord> sessions=new HashMap<>();
        int generated,folderCreates,uploads;boolean folderTimeout=true,shared;final List<String> parents=new ArrayList<>();
        Transport(Store store){this.store=store;}
        HttpDriveGateway.Response response(int status,String body){return new HttpDriveGateway.Response(status,body,null,null);}
        JsonObject metadata(String id,String mime,String parent){JsonObject json=new JsonObject();json.addProperty("id",id);json.addProperty("mimeType",mime);json.addProperty("trashed",false);json.addProperty("shared",shared);json.addProperty("ownedByMe",true);JsonArray p=new JsonArray();p.add(parent);json.add("parents",p);json.add("owners",JsonParser.parseString("[{\"permissionId\":\"owner\"}]"));return json;}
        public HttpDriveGateway.Response execute(String method,String url,Map<String,String> headers,byte[] body)throws IOException{
            assertEquals("Bearer fictional-token",headers.get("Authorization"));assertFalse("No name-based folder search",url.contains("q="));URI uri=URI.create(url);String path=uri.getPath();
            if(path.endsWith("/about"))return response(200,"{\"user\":{\"permissionId\":\"owner\"}}");
            if(path.endsWith("/files/root"))return response(200,"{\"id\":\"root\"}");
            if(path.endsWith("/files/generateIds"))return response(200,"{\"ids\":[\"remote-"+(++generated)+"\"]}");
            if(path.endsWith("/permissions"))return response(200,"{\"permissions\":[{\"id\":\"owner\",\"type\":\"user\",\"role\":\"owner\"}]}");
            if(method.equals("POST")&&path.equals("/drive/v3/files")){
                JsonObject json=JsonParser.parseString(new String(body,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();String id=json.get("id").getAsString();assertEquals(id,store.assignmentFolder("owner","assignment").id);folderCreates++;remote.put(id,metadata(id,"application/vnd.google-apps.folder","root"));
                if(folderTimeout){folderTimeout=false;throw new IOException("Fictional response lost after folder commit");}return response(200,"{\"id\":\""+id+"\"}");
            }
            if(method.equals("POST")&&path.equals("/upload/drive/v3/files")){
                JsonObject json=JsonParser.parseString(new String(body,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();String id=json.get("id").getAsString();parents.add(json.getAsJsonArray("parents").get(0).getAsString());
                UploadRecord found=store.records.values().stream().filter(r->id.equals(r.fileId)).findFirst().orElseThrow();sessions.put(id,found);return new HttpDriveGateway.Response(200,"{}","https://www.googleapis.com/upload/drive/v3/files?upload_id="+id,null);
            }
            if(method.equals("PUT")){
                String id=uri.getQuery().substring("upload_id=".length());UploadRecord r=sessions.get(id);
                if(headers.get("Content-Range").startsWith("bytes */"))return response(308,"");
                assertArrayEquals(Files.readAllBytes(new File(r.localPath).toPath()),body);JsonObject file=metadata(id,"application/zip",r.folderId);file.addProperty("size",r.size);file.addProperty("md5Checksum",r.md5);file.addProperty("sha256Checksum",r.sha256);remote.put(id,file);uploads++;return response(200,"{}");
            }
            if(method.equals("GET")&&path.startsWith("/drive/v3/files/")){JsonObject file=remote.get(path.substring("/drive/v3/files/".length()));if(file==null)return response(404,"{}");JsonObject snapshot=file.deepCopy();snapshot.addProperty("shared",shared);return response(200,snapshot.toString());}
            throw new IOException("Unexpected fictional request");
        }
    }
    @Test public void timeoutRestartAndSupplementReuseOneVerifiedFolderThroughHttpTransport()throws Exception{
        File file=File.createTempFile("fictional-supplement-",".zip");try{
            Files.write(file.toPath(),"fictional capture bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8));Store store=new Store();
            for(String id:new String[]{"original","late","blocked"}){UploadRecord r=new UploadRecord();r.queueId=id;r.accountId="owner";r.assignmentId="assignment";r.assignmentName="Duplicate name hint";r.name=id+".zip";r.localPath=file.getPath();r.size=file.length();r.md5=TransferEngine.digest(file,"MD5");r.sha256=TransferEngine.digest(file,"SHA-256");store.save(r);}
            Transport transport=new Transport(store);HttpDriveGateway gateway=new HttpDriveGateway(()->"fictional-token",()->true,transport);
            assertEquals(TransferEngine.State.RETRY,new TransferEngine(gateway,store,()->true,()->"owner").run("original"));
            assertEquals(TransferEngine.State.COMPLETE,new TransferEngine(gateway,store,()->true,()->"owner").run("late"));
            assertEquals(TransferEngine.State.COMPLETE,new TransferEngine(gateway,store,()->true,()->"owner").run("original"));
            assertEquals(1,transport.folderCreates);assertEquals(2,transport.uploads);assertEquals(transport.parents.get(0),transport.parents.get(1));assertNotEquals(store.load("late").fileId,store.load("original").fileId);
            transport.shared=true;assertEquals(TransferEngine.State.BLOCKED,new TransferEngine(gateway,store,()->true,()->"owner").run("blocked"));assertEquals(2,transport.uploads);assertTrue(file.exists());
        }finally{file.delete();}
    }
}
