package org.studentorganizer.capture.transfer;
import org.junit.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.Assert.*;

public class HttpDriveGatewayTest {
    @Test public void rejectsUntrustedSessionBeforeTokenOrNetwork() throws Exception {
        for(String url:List.of("http://www.googleapis.com/upload/drive/v3/files?upload_id=a","https://evil.invalid/upload/drive/v3/files?upload_id=a","https://www.googleapis.com.evil.invalid/upload/drive/v3/files?upload_id=a","https://www.googleapis.com/drive/v3/files?upload_id=a")) {
            try{HttpDriveGateway.validateSession(url);fail(url);}catch(IOException expected){}
        }
    }
    @Test public void resumesFromServerOffsetAndUsesDirectBearer() throws Exception {
        File local=File.createTempFile("fictional-page",".zip");Files.write(local.toPath(),new byte[]{1,2,3,4,5});
        try {
            UploadRecord r=new UploadRecord();r.localPath=local.toString();r.size=5;r.sessionUrl="https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fictional";
            List<String> ranges=new ArrayList<>();List<byte[]> bodies=new ArrayList<>();
            HttpDriveGateway g=new HttpDriveGateway(()->"fictional-token",()->true,(method,url,headers,body)->{
                assertTrue(url.startsWith("https://www.googleapis.com/"));assertEquals("Bearer fictional-token",headers.get("Authorization"));assertEquals("PUT",method);
                ranges.add(headers.get("Content-Range"));bodies.add(body);
                return ranges.size()==1?new HttpDriveGateway.Response(308,"",null,"bytes=0-1"):new HttpDriveGateway.Response(200,"{}",null,null);
            });
            g.upload(r);assertEquals(List.of("bytes */5","bytes 2-4/5"),ranges);assertArrayEquals(new byte[]{3,4,5},bodies.get(1));
        }finally{local.delete();}
    }
    @Test public void disabledGatewayNeverObtainsToken() throws Exception {
        HttpDriveGateway g=new HttpDriveGateway(()->{throw new AssertionError();},()->false,(m,u,h,b)->{throw new AssertionError();});
        try{g.generateId();fail();}catch(IOException expected){}
    }
    @Test public void permissionPaginationIncludesInheritedReaders() throws Exception {
        HttpDriveGateway g=new HttpDriveGateway(()->"fixture",()->true,(m,u,h,b)->{
            String json;
            if(u.contains("pageToken="))json="{\"permissions\":[{\"id\":\"reader\",\"type\":\"user\",\"role\":\"reader\"}]}";
            else if(u.contains("/permissions?"))json="{\"nextPageToken\":\"second\",\"permissions\":[{\"id\":\"owner\",\"type\":\"user\",\"role\":\"owner\"}]}";
            else json="{\"id\":\"folder\",\"mimeType\":\"application/vnd.google-apps.folder\",\"parents\":[\"root\"],\"ownedByMe\":true,\"trashed\":false,\"shared\":false,\"owners\":[{\"permissionId\":\"owner\"}]}";
            return new HttpDriveGateway.Response(200,json,null,null);
        });
        DriveGateway.Metadata metadata=g.metadata("folder");assertEquals(2,metadata.permissions.size());assertFalse(TransferEngine.privateOwned(metadata,"owner"));
    }
    @Test public void missingPrivacyFieldsFailClosed() throws Exception {
        HttpDriveGateway g=new HttpDriveGateway(()->"fixture",()->true,(m,u,h,b)->new HttpDriveGateway.Response(200,u.contains("permissions")?"{\"permissions\":[]}":"{\"id\":\"folder\"}",null,null));
        assertFalse(TransferEngine.privateOwned(g.metadata("folder"),"owner"));
    }
    @Test public void malformedResponseShapesBecomeIoFailures() throws Exception {
        for(String response:List.of("{}", "[]", "null", "{\"owners\":{}}", "{\"size\":\"nonsense\"}")) {
            HttpDriveGateway g=new HttpDriveGateway(()->"fixture",()->true,(m,u,h,b)->new HttpDriveGateway.Response(200,response,null,null));
            try{g.identity();fail();}catch(IOException expected){}
            try{g.isRootChild("fixture");fail();}catch(IOException expected){}
            try{g.generateId();fail();}catch(IOException expected){}
            try{g.metadata("fixture");fail();}catch(IOException expected){}
        }
    }
    @Test public void rootMembershipUsesExactIdAndPaginatesWithoutReadingRootMetadata()throws Exception {
        List<String> calls=new ArrayList<>();
        HttpDriveGateway g=new HttpDriveGateway(()->"fixture",()->true,(m,u,h,b)->{
            calls.add(u);assertFalse(u.contains("files/root"));assertEquals("GET",m);
            String query=java.net.URLDecoder.decode(u,"UTF-8");assertTrue(query.contains("'root' in parents and trashed = false"));assertFalse(query.contains("name ="));
            return new HttpDriveGateway.Response(200,calls.size()==1?"{\"files\":[],\"nextPageToken\":\"next\"}":"{\"files\":[{\"id\":\"reserved-folder\"}]}",null,null);
        });
        assertTrue(g.isRootChild("reserved-folder"));assertEquals(2,calls.size());assertTrue(calls.get(1).contains("pageToken=next"));
    }
    @Test public void rootMembershipNeverGuessesFromAnotherFolderOrIncompleteResults()throws Exception {
        HttpDriveGateway absent=new HttpDriveGateway(()->"fixture",()->true,(m,u,h,b)->new HttpDriveGateway.Response(200,"{\"files\":[{\"id\":\"other-folder\"}]}",null,null));
        assertFalse(absent.isRootChild("reserved-folder"));
        for(String response:List.of("{\"files\":[{\"id\":\"reserved-folder\"}],\"incompleteSearch\":true}","{\"files\":[],\"nextPageToken\":\"repeat\"}","{\"files\":[{\"id\":{}}]}","{\"files\":[],\"incompleteSearch\":{}}","{}")){
            HttpDriveGateway g=new HttpDriveGateway(()->"fixture",()->true,(m,u,h,b)->new HttpDriveGateway.Response(200,response,null,null));
            assertThrows(IOException.class,()->g.isRootChild("reserved-folder"));
        }
    }
}
