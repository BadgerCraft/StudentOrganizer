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
    static final int MAX_BYTES = 34 * 1024 * 1024;
    private final File directory;
    interface DirectorySync { void sync(File directory) throws Exception; }
    private final DirectorySync directorySync;
    CaptureQueue(Context context) { this(context, directory -> {java.io.FileDescriptor fd=android.system.Os.open(directory.getAbsolutePath(),android.system.OsConstants.O_RDONLY,0);try {android.system.Os.fsync(fd);}finally{android.system.Os.close(fd);}}); }
    CaptureQueue(Context context,DirectorySync directorySync) { super(context, "capture-transfer.db", null, 1); this.directorySync=directorySync; directory = new File(context.getFilesDir(), "capture-queue"); if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot open local queue"); }
    @Override public void onConfigure(SQLiteDatabase db) { db.execSQL("PRAGMA synchronous=FULL"); }
    public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE queue(id TEXT PRIMARY KEY, capture TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(capture,revision))"); }
    public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) { throw new IllegalStateException("No migration defined"); }
    static String digest(byte[] bytes, String algorithm) throws Exception { byte[] result=MessageDigest.getInstance(algorithm).digest(bytes); StringBuilder out=new StringBuilder(); for(byte b:result) out.append(String.format(Locale.ROOT,"%02x",b&255)); return out.toString(); }
    static void validate(byte[] bytes,String capture,long revision) throws Exception {
        if(bytes.length==0 || bytes.length>MAX_BYTES || !capture.matches("[a-zA-Z0-9-]{1,80}") || revision<0) throw new IOException("Invalid batch size or identity");
        JSONObject manifest=null; Set<String> names=new HashSet<>(); Map<String,byte[]> pages=new HashMap<>(); long total=0;
        try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry; byte[] buffer=new byte[8192];
            while((entry=zip.getNextEntry())!=null) {
                String name=entry.getName(); if(names.size()>102 || !names.add(name) || !(name.equals("manifest.json")||name.equals("README.txt")||name.matches("pages/[0-9]{3}\\.(jpg|png)"))) throw new IOException("Unexpected archive entry");
                ByteArrayOutputStream content=new ByteArrayOutputStream(); int n; while((n=zip.read(buffer))!=-1) {total+=n; if(total>MAX_BYTES || ((name.equals("manifest.json")||name.equals("README.txt"))&&content.size()+n>1024*1024)) throw new IOException("Archive too large"); content.write(buffer,0,n);}
                if(name.equals("manifest.json")) manifest=new JSONObject(content.toString(StandardCharsets.UTF_8.name()));
                else if(name.startsWith("pages/")) pages.put(name,content.toByteArray());
            }
        }
        if(manifest==null || !manifest.getString("format").equals("studentorganizer-capture") || manifest.getInt("version")!=1 || !manifest.getBoolean("fictional") || !manifest.getBoolean("requiresExplicitDesktopMatching") || !manifest.getString("batchId").equals(capture) || manifest.getLong("revision")!=revision) throw new IOException("Manifest does not match fictional batch");
        JSONArray list=manifest.getJSONArray("pages"); if(list.length()==0 || list.length()!=pages.size()) throw new IOException("Invalid page list");
        for(int i=0;i<list.length();i++){JSONObject page=list.getJSONObject(i); byte[] content=pages.remove(page.getString("path")); if(content==null || page.getInt("order")!=i+1 || !page.isNull("studentId") || !page.getString("matchStatus").equals("unmatched") || page.getString("labelHint").trim().isEmpty() || page.getLong("byteLength")!=content.length || !page.getString("sha256").equals(digest(content,"SHA-256"))) throw new IOException("Invalid or matched page");}
    }
    synchronized String enqueue(byte[] bytes,String capture,long revision,String account) throws Exception {
        if(account==null||account.trim().isEmpty())throw new IOException("Choose a Google account first");
        validate(bytes,capture,revision); String hash=digest(bytes,"SHA-256");
        try(Cursor c=getReadableDatabase().rawQuery("SELECT id,digest,record FROM queue WHERE capture=? AND revision=?",new String[]{capture,Long.toString(revision)})) {
            if(c.moveToFirst()){ if(!hash.equals(c.getString(1)) || !account.equals(new JSONObject(c.getString(2)).getString("accountId"))) throw new IOException("Batch revision already queued with different bytes or account"); return c.getString(0); }
        }
        String id=UUID.randomUUID().toString(); File temporary=new File(directory,id+".pending"), target=new File(directory,id+".zip");
        try(FileOutputStream stream=new FileOutputStream(temporary)){stream.write(bytes);stream.getFD().sync();}
        if(!temporary.renameTo(target)) throw new IOException("Unable to retain original batch");
        directorySync.sync(directory);
        UploadRecord r=new UploadRecord(); r.queueId=id;r.accountId=account;r.localPath=target.getAbsolutePath();r.name="capture-"+capture+"-r"+revision+".zip";r.size=bytes.length;r.md5=digest(bytes,"MD5");r.sha256=hash;r.state=State.QUEUED;
        ContentValues v=new ContentValues();v.put("id",id);v.put("capture",capture);v.put("revision",revision);v.put("digest",hash);v.put("record",encode(r).toString()); getWritableDatabase().insertOrThrow("queue",null,v); return id;
    }
    public synchronized UploadRecord load(String id) {try(Cursor c=getReadableDatabase().rawQuery("SELECT record FROM queue WHERE id=?",new String[]{id})){if(!c.moveToFirst()) throw new IllegalArgumentException("Unknown queue item");return decode(c.getString(0));}}
    public synchronized void save(UploadRecord r) {ContentValues values=new ContentValues();values.put("record",encode(r).toString());if(getWritableDatabase().update("queue",values,"id=?",new String[]{r.queueId})!=1) throw new IllegalStateException("Queue item missing");}
    List<UploadRecord> all(){List<UploadRecord> records=new ArrayList<>();try(Cursor c=getReadableDatabase().rawQuery("SELECT record FROM queue ORDER BY rowid",null)){while(c.moveToNext())records.add(decode(c.getString(0)));}return records;}
    private static JSONObject encode(UploadRecord r) {try{JSONObject j=new JSONObject();for(var field:UploadRecord.class.getFields()) {Object value=field.get(r); if(value!=null)j.put(field.getName(),value instanceof Enum?value.toString():value);}return j;}catch(Exception e){throw new IllegalStateException(e);}}
    private static UploadRecord decode(String text){try{JSONObject j=new JSONObject(text);UploadRecord r=new UploadRecord();for(var field:UploadRecord.class.getFields()){if(!j.has(field.getName()))continue;if(field.getType()==String.class)field.set(r,j.getString(field.getName()));else if(field.getType()==long.class)field.setLong(r,j.getLong(field.getName()));else if(field.getType()==State.class)field.set(r,State.valueOf(j.getString(field.getName())));}return r;}catch(Exception e){throw new IllegalStateException("Invalid queue metadata",e);}}
}
