package org.studentorganizer.capture.transfer;

import com.google.gson.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.*;

/** Direct HTTPS Drive v3 transport. Token is supplied per request and is never persisted or logged. */
public final class HttpDriveGateway implements DriveGateway {
    private static final String API="https://www.googleapis.com/drive/v3/";
    private static final String UPLOAD="https://www.googleapis.com/upload/drive/v3/files";
    private static final String FIELDS="id,mimeType,parents,trashed,shared,ownedByMe,owners(permissionId),size,md5Checksum,sha256Checksum";
    private final Supplier<String> token;
    private final BooleanSupplier enabled;
    private final Transport transport;
    public interface Transport { Response execute(String method,String url,Map<String,String> headers,byte[] body) throws IOException; }
    public static final class Response {
        public final int status;
        public final String body,location,range;
        public Response(int status,String body,String location,String range) { this.status=status;this.body=body;this.location=location;this.range=range; }
    }
    public HttpDriveGateway(Supplier<String> token,BooleanSupplier enabled) { this(token,enabled,new HttpsTransport()); }
    public HttpDriveGateway(Supplier<String> token,BooleanSupplier enabled,Transport transport) {this.token=token;this.enabled=enabled;this.transport=transport;}
    @Override public String identity() throws IOException {
        try { return required(object(request("GET",API+"about?fields=user(permissionId)",null,null)).getAsJsonObject("user"),"permissionId"); }
        catch (RuntimeException e) { throw new IOException("Invalid Drive identity response"); }
    }
    @Override public boolean isRootChild(String id) throws IOException {
        try{return readRootMembership(id);}catch(RuntimeException error){throw new IOException("Invalid root membership response");}
    }
    private boolean readRootMembership(String id) throws IOException {
        segment(id);String page=null;Set<String> seen=new HashSet<>();
        // drive.file need not expose root metadata. Query its app-authorized children,
        // selecting only the already reserved ID, never an assignment display name.
        for(int count=0;count<100;count++) {
            JsonObject result=object(request("GET",API+"files?q="+encode("'root' in parents and trashed = false")
                +"&corpora=user&spaces=drive&pageSize=100&fields="+encode("files(id),nextPageToken,incompleteSearch")
                +(page==null?"":"&pageToken="+encode(page)),null,null));
            if(!result.has("files")||!result.get("files").isJsonArray()||bool(result,"incompleteSearch",false))throw new IOException("Root membership could not be verified");
            for(JsonElement item:result.getAsJsonArray("files")) {
                if(!item.isJsonObject())throw new IOException("Invalid root membership response");
                if(id.equals(required(item.getAsJsonObject(),"id")))return true;
            }
            page=str(result,"nextPageToken");if(page==null||page.isEmpty())return false;
            if(!seen.add(page))throw new IOException("Repeated root membership page");
        }
        throw new IOException("Root membership lookup limit reached");
    }
    @Override public String generateId() throws IOException {
        try { return segment(object(request("GET",API+"files/generateIds?count=1&space=drive&type=files",null,null)).getAsJsonArray("ids").get(0).getAsString()); }
        catch (RuntimeException e) { throw new IOException("Invalid Drive generated ID response"); }
    }
    @Override public Metadata metadata(String id) throws IOException {
        try { return readMetadata(id); }
        catch (RuntimeException e) { throw new IOException("Invalid Drive metadata response"); }
    }
    private Metadata readMetadata(String id) throws IOException {
        Response response=request("GET",API+"files/"+segment(id)+"?fields="+encode(FIELDS),null,null);
        if(response.status==404) return null;
        JsonObject o=object(response); Metadata m=new Metadata();
        m.id=str(o,"id");m.mimeType=str(o,"mimeType");m.md5=str(o,"md5Checksum");m.sha256=str(o,"sha256Checksum");
        m.size=o.has("size")?o.get("size").getAsLong():-1;m.trashed=bool(o,"trashed",true);m.shared=bool(o,"shared",true);m.ownedByMe=bool(o,"ownedByMe",false);
        m.parents=new ArrayList<>();if(o.has("parents"))for(JsonElement e:o.getAsJsonArray("parents"))m.parents.add(e.getAsString());
        m.ownerIds=new ArrayList<>();if(o.has("owners"))for(JsonElement e:o.getAsJsonArray("owners"))m.ownerIds.add(str(e.getAsJsonObject(),"permissionId"));
        m.permissions=new ArrayList<>();String page=null;
        do {
            JsonObject permissions=object(request("GET",API+"files/"+segment(id)+"/permissions?fields="+encode("nextPageToken,permissions(id,type,role,deleted)")+"&pageSize=100"+(page==null?"":"&pageToken="+encode(page)),null,null));
            if(!permissions.has("permissions")) throw new IOException("Permissions unavailable");
            for(JsonElement e:permissions.getAsJsonArray("permissions")) {JsonObject p=e.getAsJsonObject();Permission permission=new Permission(str(p,"id"),str(p,"type"),str(p,"role"));permission.deleted=bool(p,"deleted",false);m.permissions.add(permission);}
            page=str(permissions,"nextPageToken");
        } while(page!=null && !page.isEmpty());
        return m;
    }
    @Override public void createFolder(String id,String name) throws IOException {
        JsonObject o=new JsonObject();o.addProperty("id",id);o.addProperty("name",name);o.addProperty("mimeType","application/vnd.google-apps.folder");JsonArray parents=new JsonArray();parents.add("root");o.add("parents",parents);
        object(request("POST",API+"files?fields=id",Collections.singletonMap("Content-Type","application/json; charset=UTF-8"),json(o)));
    }
    @Override public String begin(UploadRecord r) throws IOException {
        JsonObject o=new JsonObject();o.addProperty("id",r.fileId);o.addProperty("name",r.name);o.addProperty("mimeType","application/zip");JsonArray parents=new JsonArray();parents.add(r.folderId);o.add("parents",parents);
        Map<String,String> h=new HashMap<>();h.put("Content-Type","application/json; charset=UTF-8");h.put("X-Upload-Content-Type","application/zip");h.put("X-Upload-Content-Length",Long.toString(r.size));
        Response response=request("POST",UPLOAD+"?uploadType=resumable&fields=id",h,json(o));check(response);
        validateSession(response.location);return response.location;
    }
    @Override public void upload(UploadRecord r) throws IOException {
        validateSession(r.sessionUrl);
        Response status=request("PUT",r.sessionUrl,Collections.singletonMap("Content-Range","bytes */"+r.size),new byte[0]);
        if(status.status==200 || status.status==201) return;
        long offset=offset(status,r.size);
        try(RandomAccessFile input=new RandomAccessFile(r.localPath,"r")) {
            while(offset<r.size) {
                if(!enabled.getAsBoolean())throw new IOException("Transfer disabled");
                int count=(int)Math.min(1024*1024,r.size-offset);byte[] data=new byte[count];input.seek(offset);input.readFully(data);
                Map<String,String> h=new HashMap<>();h.put("Content-Type","application/zip");h.put("Content-Range","bytes "+offset+"-"+(offset+count-1)+"/"+r.size);
                Response next=request("PUT",r.sessionUrl,h,data);
                if(next.status==200 || next.status==201)return;
                long accepted=offset(next,r.size);
                if(accepted<=offset || accepted>offset+count)throw new IOException("Invalid resume offset");
                offset=accepted;
            }
        }
        throw new IOException("Upload completion not confirmed");
    }
    private static long offset(Response response,long size) throws IOException {
        if(response.status!=308){check(response);throw new IOException("Unexpected upload status");}
        if(response.range==null || response.range.isEmpty())return 0;
        if(!response.range.matches("bytes=0-[0-9]+"))throw new IOException("Invalid upload range");
        try {long offset=Long.parseLong(response.range.substring(8))+1;if(offset<0 || offset>size)throw new IOException("Invalid upload range");return offset;}catch(NumberFormatException e){throw new IOException("Invalid upload range");}
    }
    private Response request(String method,String url,Map<String,String> headers,byte[] body) throws IOException {
        validateTarget(url);
        if(!enabled.getAsBoolean())throw new IOException("Transfer disabled");
        String access=token.get();if(access==null || access.isEmpty())throw new Failure(401,"missingToken");
        Map<String,String> h=new HashMap<>();if(headers!=null)h.putAll(headers);h.put("Authorization","Bearer "+access);
        return transport.execute(method,url,h,body);
    }
    public static void validateSession(String url) throws IOException {
        validateTarget(url);URI u=URI.create(url);
        if(!"/upload/drive/v3/files".equals(u.getPath()) || u.getRawQuery()==null || !u.getRawQuery().contains("upload_id="))throw new IOException("Invalid Drive upload session");
    }
    private static void validateTarget(String url) throws IOException {
        try {URI u=URI.create(url);if(!"https".equals(u.getScheme()) || !"www.googleapis.com".equals(u.getHost()) || u.getPort()!=-1 || u.getUserInfo()!=null || u.getFragment()!=null || !(u.getPath().startsWith("/drive/v3/") || u.getPath().equals("/upload/drive/v3/files")))throw new IOException("Untrusted Drive endpoint");}
        catch(IllegalArgumentException | NullPointerException e){throw new IOException("Invalid Drive endpoint");}
    }
    private static String segment(String id) throws IOException {if(id==null || !id.matches("[A-Za-z0-9_-]+"))throw new IOException("Invalid Drive ID");return id;}
    private static String encode(String value){try{return URLEncoder.encode(value,"UTF-8");}catch(UnsupportedEncodingException impossible){throw new AssertionError(impossible);}}
    private static byte[] json(JsonObject o){return o.toString().getBytes(StandardCharsets.UTF_8);}
    private static String required(JsonObject o,String name) throws IOException {
        String result=str(o,name);if(result==null || result.isEmpty())throw new IOException("Missing Drive response field");return result;
    }
    private static String str(JsonObject o,String name){return o.has(name)&&!o.get(name).isJsonNull()?o.get(name).getAsString():null;}
    private static boolean bool(JsonObject o,String name,boolean fallback){return o.has(name)?o.get(name).getAsBoolean():fallback;}
    private static JsonObject object(Response r) throws IOException {check(r);try{return JsonParser.parseString(r.body).getAsJsonObject();}catch(RuntimeException e){throw new IOException("Invalid Drive response");}}
    private static void check(Response r) throws IOException {
        if(r.status>=200 && r.status<300)return;
        String reason="unknown";
        try {reason=JsonParser.parseString(r.body).getAsJsonObject().getAsJsonObject("error").getAsJsonArray("errors").get(0).getAsJsonObject().get("reason").getAsString();}catch(RuntimeException ignored){}
        throw new Failure(r.status,reason);
    }
    private static final class HttpsTransport implements Transport {
        public Response execute(String method,String url,Map<String,String> headers,byte[] body) throws IOException {
            HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();
            try {
                c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(30000);c.setRequestMethod(method);
                for(Map.Entry<String,String> h:headers.entrySet())c.setRequestProperty(h.getKey(),h.getValue());
                if(body!=null){c.setDoOutput(true);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}}
                int code=c.getResponseCode();InputStream in=code>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream();
                if(in!=null)try(InputStream source=in){byte[] bytes=new byte[4096];int n;while((n=source.read(bytes))!=-1){if(out.size()+n>1024*1024)throw new IOException("Drive response too large");out.write(bytes,0,n);}}
                return new Response(code,new String(out.toByteArray(),StandardCharsets.UTF_8),c.getHeaderField("Location"),c.getHeaderField("Range"));
            } finally {c.disconnect();}
        }
    }
}
