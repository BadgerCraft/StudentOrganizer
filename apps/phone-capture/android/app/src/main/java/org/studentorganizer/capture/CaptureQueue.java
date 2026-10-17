package org.studentorganizer.capture;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import org.json.*;
import org.studentorganizer.capture.transfer.*;
import org.studentorganizer.capture.transfer.TransferEngine.State;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Original ZIP bytes remain in private storage; database commits only after durable file close. */
final class CaptureQueue extends SQLiteOpenHelper implements QueueStore {
    static final int MAX_BYTES = 256 * 1024 * 1024;
    private final File directory;
    interface DirectorySync { void sync(File directory) throws Exception; }
    private final DirectorySync directorySync;
    CaptureQueue(Context context) { this(context, directory -> {java.io.FileDescriptor fd=android.system.Os.open(directory.getAbsolutePath(),android.system.OsConstants.O_RDONLY,0);try {android.system.Os.fsync(fd);}finally{android.system.Os.close(fd);}}); }
    CaptureQueue(Context context,DirectorySync directorySync) { super(context, "capture-transfer.db", null, 1); this.directorySync=directorySync; directory = new File(context.getFilesDir(), "capture-queue"); if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot open local queue"); }
    @Override public void onConfigure(SQLiteDatabase db) { db.execSQL("PRAGMA synchronous=FULL"); }
    public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE queue(id TEXT PRIMARY KEY, capture TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(capture,revision))"); }
    public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) { throw new IllegalStateException("No migration defined"); }
    static String digest(byte[] bytes, String algorithm) throws Exception { byte[] result=MessageDigest.getInstance(algorithm).digest(bytes); StringBuilder out=new StringBuilder(); for(byte b:result) out.append(String.format(Locale.ROOT,"%02x",b&255)); return out.toString(); }
    static final String ID="[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}";
    static void fields(JSONObject object,String... names) throws IOException {
        if(object.length()!=names.length)throw new IOException("Unexpected metadata fields");
        for(String name:names)if(!object.has(name))throw new IOException("Missing metadata");
    }
    static String text(JSONObject object,String key) throws Exception {Object value=object.get(key);if(!(value instanceof String))throw new IOException("Invalid text");return (String)value;}
    static long integer(JSONObject object,String key) throws Exception {Object value=object.get(key);if(!(value instanceof Number)||!Double.isFinite(((Number)value).doubleValue())||((Number)value).doubleValue()!=((Number)value).longValue())throw new IOException("Invalid integer");return ((Number)value).longValue();}
    static boolean label(String value){return !value.trim().isEmpty()&&value.length()<=200&&!value.matches("(?s).*[\\x00-\\x1f\\x7f].*");}
    static byte[] readEntry(ZipFile zip,ZipEntry entry,int limit) throws Exception {
        if(entry==null||entry.getSize()<1||entry.getSize()>limit)throw new IOException("Invalid entry size");
        ByteArrayOutputStream out=new ByteArrayOutputStream();CRC32 crc=new CRC32();
        try(InputStream in=zip.getInputStream(entry)){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>entry.getSize()||out.size()+n>limit)throw new IOException("Expanded entry too large");out.write(buffer,0,n);crc.update(buffer,0,n);}}
        if(out.size()!=entry.getSize()||crc.getValue()!=entry.getCrc())throw new IOException("Entry checksum mismatch");return out.toByteArray();
    }
    static long le(RandomAccessFile file,int count)throws IOException{long result=0;for(int i=0;i<count;i++)result|=(long)file.readUnsignedByte()<<(8*i);return result;}
    static long at(RandomAccessFile file,long offset,int count)throws IOException{file.seek(offset);return le(file,count);}
    /** Match the narrow desktop ZIP framing before allowing Java's decompressor to read any entry. */
    static void inspectZip(File source)throws Exception {
        try(RandomAccessFile f=new RandomAccessFile(source,"r")){
            long end=f.length()-22;if(end<0||f.length()>MAX_BYTES||at(f,end,4)!=0x06054b50L||at(f,end+4,2)!=0||at(f,end+6,2)!=0||at(f,end+20,2)!=0)throw new IOException("Unsupported ZIP framing");
            long count=at(f,end+10,2),directory=at(f,end+16,4),size=at(f,end+12,4);
            if(count<2||count>401||at(f,end+8,2)!=count||directory+size!=end)throw new IOException("Invalid ZIP directory");
            Set<String> names=new HashSet<>();List<long[]> ranges=new ArrayList<>();long cursor=directory,total=0;
            for(int i=0;i<count;i++){
                if(cursor+46>end||at(f,cursor,4)!=0x02014b50L)throw new IOException("Invalid ZIP entry");
                long version=at(f,cursor+6,2),flags=at(f,cursor+8,2),method=at(f,cursor+10,2),crc=at(f,cursor+16,4),packed=at(f,cursor+20,4),expanded=at(f,cursor+24,4),length=at(f,cursor+28,2),attributes=at(f,cursor+38,4),local=at(f,cursor+42,4);
                if(version>20||(flags&~0x800L)!=0||(method!=0&&method!=8)||at(f,cursor+30,2)!=0||at(f,cursor+32,2)!=0||at(f,cursor+34,2)!=0||length<1||cursor+46+length>end||((attributes>>16)&0xf000)!=0&&((attributes>>16)&0xf000)!=0x8000||(attributes&16)!=0)throw new IOException("Unsupported ZIP entry");
                byte[] nameBytes=new byte[(int)length];f.seek(cursor+46);f.readFully(nameBytes);String name=new String(nameBytes,StandardCharsets.UTF_8);
                if(!(name.equals("manifest.json")||name.matches("pages/"+ID+"/"+ID+"\\.(png|jpg)"))||!names.add(name.toLowerCase(Locale.ROOT)))throw new IOException("Unsafe or duplicate path");
                long limit=name.equals("manifest.json")?1024*1024:8*1024*1024;
                if(expanded<1||expanded>limit||packed<1||expanded>packed*200||(method==0&&packed!=expanded)||(total+=expanded)>MAX_BYTES)throw new IOException("ZIP budget exceeded");
                if(local+30>directory||at(f,local,4)!=0x04034b50L||at(f,local+4,2)!=version||at(f,local+6,2)!=flags||at(f,local+8,2)!=method||at(f,local+14,4)!=crc||at(f,local+18,4)!=packed||at(f,local+22,4)!=expanded||at(f,local+26,2)!=length||at(f,local+28,2)!=0)throw new IOException("ZIP headers disagree");
                long start=local+30+length;if(start+packed>directory)throw new IOException("Invalid ZIP extent");byte[] localName=new byte[(int)length];f.seek(local+30);f.readFully(localName);if(!Arrays.equals(nameBytes,localName))throw new IOException("ZIP paths disagree");
                ranges.add(new long[]{local,start+packed});cursor+=46+length;
            }
            if(cursor!=end)throw new IOException("Unexpected directory data");ranges.sort(Comparator.comparingLong(r->r[0]));long next=0;for(long[] range:ranges){if(range[0]!=next)throw new IOException("Overlapping or unlisted ZIP bytes");next=range[1];}if(next!=directory)throw new IOException("Unexpected ZIP bytes");
        }
    }
    static void imageFraming(byte[] bytes,String mime)throws IOException {
        if(mime.equals("image/jpeg")) {
            if(bytes.length<4||(bytes[0]&255)!=255||(bytes[1]&255)!=216||(bytes[bytes.length-2]&255)!=255||(bytes[bytes.length-1]&255)!=217)throw new IOException("Truncated JPEG framing");
            return; // The platform codec additionally decodes the complete bounded image below.
        }
        byte[] signature={(byte)137,80,78,71,13,10,26,10};
        if(bytes.length<33||!Arrays.equals(signature,Arrays.copyOf(bytes,8)))throw new IOException("Invalid PNG signature");
        java.nio.ByteBuffer view=java.nio.ByteBuffer.wrap(bytes);int at=8;boolean data=false,ended=false;
        while(at<bytes.length){
            if(bytes.length-at<12)throw new IOException("Truncated PNG chunk");long length=Integer.toUnsignedLong(view.getInt(at));long end=(long)at+12+length;
            if(end>bytes.length)throw new IOException("PNG chunk exceeds image");String kind=new String(bytes,at+4,4,StandardCharsets.US_ASCII);CRC32 crc=new CRC32();crc.update(bytes,at+4,(int)length+4);
            if(!kind.matches("[a-zA-Z]{4}")||crc.getValue()!=Integer.toUnsignedLong(view.getInt((int)end-4)))throw new IOException("PNG checksum mismatch");
            if(at==8&&(!kind.equals("IHDR")||length!=13)||at!=8&&kind.equals("IHDR")||kind.equals("acTL")||kind.equals("fcTL")||kind.equals("fdAT"))throw new IOException("Unsupported PNG image");
            if(kind.equals("IDAT"))data=true;
            if(kind.equals("IEND")){if(length!=0||!data||end!=bytes.length)throw new IOException("Invalid PNG ending");ended=true;}
            at=(int)end;
        }
        if(!ended)throw new IOException("Incomplete PNG image");
    }
    static JSONObject validate(File source,String capture,long revision)throws Exception {
        if(capture==null||!capture.matches(ID)||revision<1||revision>9007199254740991L)throw new IOException("Invalid package identity");inspectZip(source);
        try(ZipFile zip=new ZipFile(source)){
            JSONObject manifest=new JSONObject(StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(readEntry(zip,zip.getEntry("manifest.json"),1024*1024))).toString());
            fields(manifest,"format","version","packageId","assignmentId","assignmentName","revision","completed","submissions");
            if(!text(manifest,"format").equals("studentorganizer-capture")||integer(manifest,"version")!=2||!Boolean.TRUE.equals(manifest.get("completed"))||!text(manifest,"packageId").equals(capture)||integer(manifest,"revision")!=revision||!text(manifest,"assignmentId").matches(ID)||!label(text(manifest,"assignmentName")))throw new IOException("Only completed v2 assignment packages may transfer");
            JSONArray submissions=manifest.getJSONArray("submissions");if(submissions.length()<1||submissions.length()>40)throw new IOException("Invalid student set count");Set<String> ids=new HashSet<>(),pageIds=new HashSet<>();int entries=1;long pixels=0;
            for(int s=0;s<submissions.length();s++){
                JSONObject submission=submissions.getJSONObject(s);fields(submission,"id","label","pages");String sid=text(submission,"id");if(!sid.matches(ID)||!ids.add(sid)||!label(text(submission,"label")))throw new IOException("Invalid student page set");JSONArray pages=submission.getJSONArray("pages");if(pages.length()<1||pages.length()>10)throw new IOException("Invalid page count");
                for(int i=0;i<pages.length();i++){
                    JSONObject page=pages.getJSONObject(i);fields(page,"id","order","path","mime","byteLength","sha256","edits");String pid=text(page,"id"),mime=text(page,"mime"),hash=text(page,"sha256"),path=text(page,"path");
                    if(!pid.matches(ID)||!pageIds.add(pid)||integer(page,"order")!=i||!(mime.equals("image/png")||mime.equals("image/jpeg"))||!hash.matches("[a-f0-9]{64}")||!path.equals("pages/"+sid+"/"+pid+(mime.equals("image/png")?".png":".jpg")))throw new IOException("Invalid page identity");
                    JSONObject edits=page.getJSONObject("edits");fields(edits,"rotation","crop");long rotation=integer(edits,"rotation");if(rotation!=0&&rotation!=90&&rotation!=180&&rotation!=270)throw new IOException("Invalid rotation");JSONObject crop=edits.getJSONObject("crop");fields(crop,"x","y","width","height");for(String key:new String[]{"x","y","width","height"})if(!(crop.get(key) instanceof Number)||!Double.isFinite(crop.getDouble(key)))throw new IOException("Invalid crop");double x=crop.getDouble("x"),y=crop.getDouble("y"),w=crop.getDouble("width"),h=crop.getDouble("height");if(x<0||y<0||w<=0||h<=0||x+w>1||y+h>1)throw new IOException("Invalid crop bounds");
                    byte[] bytes=readEntry(zip,zip.getEntry(path),8*1024*1024);if(integer(page,"byteLength")!=bytes.length||!hash.equals(digest(bytes,"SHA-256")))throw new IOException("Page hash or size mismatch");
                    imageFraming(bytes,mime);
                    android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);long area=(long)options.outWidth*options.outHeight;
                    if(options.outWidth<=0||options.outHeight<=0||area>20_000_000||!mime.equals(options.outMimeType)||(pixels+=area)>800_000_000)throw new IOException("Invalid image dimensions or MIME");
                    options.inJustDecodeBounds=false;options.inPreferredConfig=android.graphics.Bitmap.Config.RGB_565;android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(bitmap==null)throw new IOException("Malformed image");bitmap.recycle();entries++;
                }
            }
            if(entries!=zip.size())throw new IOException("Unlisted archive entries");return manifest;
        }catch(JSONException e){throw new IOException("Invalid package metadata",e);}catch(OutOfMemoryError e){throw new IOException("Not enough memory to validate this image; original retained",e);}
    }
    synchronized String enqueue(byte[] bytes,String capture,long revision,String account)throws Exception {
        if(bytes.length==0||bytes.length>MAX_BYTES)throw new IOException("Invalid package size");File input=File.createTempFile("capture-input-",".zip",directory);
        try{try(FileOutputStream out=new FileOutputStream(input)){out.write(bytes);}return enqueue(input,capture,revision,account);}finally{input.delete();}
    }
    synchronized String enqueue(File source,String capture,long revision,String account)throws Exception {
        if(account==null||account.trim().isEmpty())throw new IOException("Choose a Google account first");
        if(!source.isFile()||source.length()==0||source.length()>MAX_BYTES)throw new IOException("Invalid package size");
        String id=UUID.randomUUID().toString();File temporary=new File(directory,id+".pending"),target=new File(directory,capture+"-"+id+".zip");
        try{
            try(InputStream in=new FileInputStream(source);FileOutputStream out=new FileOutputStream(temporary)){byte[] buffer=new byte[65536];long size=0;int n;while((n=in.read(buffer))!=-1){if((size+=n)>MAX_BYTES)throw new IOException("Package exceeds limit");out.write(buffer,0,n);}out.getFD().sync();}
            JSONObject manifest=validate(temporary,capture,revision);String hash=TransferEngine.digest(temporary,"SHA-256");
            try(Cursor c=getReadableDatabase().rawQuery("SELECT id,digest,record FROM queue WHERE capture=? AND revision=?",new String[]{capture,Long.toString(revision)})){
                if(c.moveToFirst()){if(!hash.equals(c.getString(1))||!account.equals(new JSONObject(c.getString(2)).getString("accountId")))throw new IOException("Package revision already queued with different bytes or account");return c.getString(0);}
            }
            UploadRecord r=new UploadRecord();r.queueId=id;r.accountId=account;r.localPath=target.getAbsolutePath();r.name="capture-"+capture+"-r"+revision+".zip";r.size=temporary.length();r.md5=TransferEngine.digest(temporary,"MD5");r.sha256=hash;r.state=State.QUEUED;r.assignmentId=manifest.getString("assignmentId");r.assignmentName=manifest.getString("assignmentName");
            if(!temporary.renameTo(target))throw new IOException("Unable to retain original package");directorySync.sync(directory);
            ContentValues v=new ContentValues();v.put("id",id);v.put("capture",capture);v.put("revision",revision);v.put("digest",hash);v.put("record",encode(r).toString());getWritableDatabase().insertOrThrow("queue",null,v);return id;
        }finally{temporary.delete();}
    }
    /** Caller holds TransferWorker.LOCK after pausing; explicit local deletion never deletes Drive copies. */
    synchronized void deleteCapture(String capture)throws IOException {
        if(capture==null||!capture.matches("[A-Za-z0-9_-]{1,80}"))throw new IOException("Invalid capture ID");
        try(Cursor rows=getReadableDatabase().rawQuery("SELECT id,record FROM queue WHERE capture=?",new String[]{capture})){
            while(rows.moveToNext()){UploadRecord r=decode(rows.getString(1));File file=new File(r.localPath);if(!file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()))throw new IOException("Unexpected queue path");if(file.exists()&&!file.delete())throw new IOException("Cannot remove retained ZIP");getWritableDatabase().delete("queue","id=?",new String[]{rows.getString(0)});}
        }
        File[] files=directory.listFiles();if(files==null)throw new IOException("Cannot enumerate retained exports");
        for(File file:files)if(file.getName().matches(java.util.regex.Pattern.quote(capture)+"-[a-f0-9-]{36}\\.zip")&&!file.delete())throw new IOException("Cannot delete retained export");
    }
    public synchronized UploadRecord load(String id) {try(Cursor c=getReadableDatabase().rawQuery("SELECT record FROM queue WHERE id=?",new String[]{id})){if(!c.moveToFirst()) throw new IllegalArgumentException("Unknown queue item");return decode(c.getString(0));}}
    public synchronized void save(UploadRecord r) {ContentValues values=new ContentValues();values.put("record",encode(r).toString());if(getWritableDatabase().update("queue",values,"id=?",new String[]{r.queueId})!=1) throw new IllegalStateException("Queue item missing");}
    /** Reload under the database write lock; never write a UI snapshot over worker IDs. */
    void retryForAccount(String account){
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try(Cursor rows=db.rawQuery("SELECT record FROM queue ORDER BY rowid",null)){
            while(rows.moveToNext()){
                UploadRecord current=decode(rows.getString(0));
                if(current.state==State.COMPLETE||!account.equals(current.accountId))continue;
                current.state=State.QUEUED;
                ContentValues values=new ContentValues();values.put("record",encode(current).toString());
                if(db.update("queue",values,"id=?",new String[]{current.queueId})!=1)throw new IllegalStateException("Queue item missing");
            }
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    List<UploadRecord> all(){List<UploadRecord> records=new ArrayList<>();try(Cursor c=getReadableDatabase().rawQuery("SELECT record FROM queue ORDER BY rowid",null)){while(c.moveToNext())records.add(decode(c.getString(0)));}return records;}
    private static JSONObject encode(UploadRecord r) {try{JSONObject j=new JSONObject();for(var field:UploadRecord.class.getFields()) {Object value=field.get(r); if(value!=null)j.put(field.getName(),value instanceof Enum?value.toString():value);}return j;}catch(Exception e){throw new IllegalStateException(e);}}
    private static UploadRecord decode(String text){try{JSONObject j=new JSONObject(text);UploadRecord r=new UploadRecord();for(var field:UploadRecord.class.getFields()){if(!j.has(field.getName()))continue;if(field.getType()==String.class)field.set(r,j.getString(field.getName()));else if(field.getType()==long.class)field.setLong(r,j.getLong(field.getName()));else if(field.getType()==State.class)field.set(r,State.valueOf(j.getString(field.getName())));}return r;}catch(Exception e){throw new IllegalStateException("Invalid queue metadata",e);}}
}
