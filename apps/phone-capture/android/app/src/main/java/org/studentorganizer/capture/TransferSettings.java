package org.studentorganizer.capture;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.*;
import java.util.function.Consumer;

/** Only successfully committed snapshots are readable. Consent never survives a process restart.
 * A persistent stop marker cannot be guaranteed when all writes fail; the process-local permit
 * therefore starts off even if old on-disk preferences still say enabled=true.
 */
final class TransferSettings {
    interface Storage { Map<String,Object> read(); boolean write(Map<String,Object> values); }
    private static TransferSettings instance;
    static synchronized TransferSettings get(Context context) {
        try {
        if(instance==null){
            SharedPreferences preferences=context.getApplicationContext().getSharedPreferences("private-drive",Context.MODE_PRIVATE);
            instance=new TransferSettings(new Storage(){
                public Map<String,Object> read(){return new HashMap<>(preferences.getAll());}
                public boolean write(Map<String,Object> values){
                    SharedPreferences.Editor editor=preferences.edit().clear();
                    for(Map.Entry<String,Object> entry:values.entrySet()){
                        Object value=entry.getValue();String key=entry.getKey();
                        if(value instanceof String)editor.putString(key,(String)value);
                        else if(value instanceof Boolean)editor.putBoolean(key,(Boolean)value);
                        else if(value instanceof Long)editor.putLong(key,(Long)value);
                        else throw new IllegalArgumentException("Unsupported setting");
                    }
                    return editor.commit();
                }
            });
        }
        } catch(RuntimeException unavailable){instance=new TransferSettings(new Storage(){public Map<String,Object> read(){throw unavailable;}public boolean write(Map<String,Object> values){return false;}});}
        return instance;
    }
    private final Storage storage;
    private Map<String,Object> committed;
    private boolean permit, failed;
    // Random per-process generation also rejects Activity state restored from a dead process.
    private long epoch=new java.security.SecureRandom().nextLong();
    TransferSettings(Storage storage){this.storage=storage;try{committed=new HashMap<>(storage.read());}catch(RuntimeException e){committed=new HashMap<>();failed=true;}}
    synchronized String text(String key,String fallback){Object value=committed.get(key);return value instanceof String?(String)value:fallback;}
    synchronized boolean flag(String key,boolean fallback){Object value=committed.get(key);return value instanceof Boolean?(Boolean)value:fallback;}
    synchronized boolean enabled(){return !failed&&permit&&!text("accountId","").isEmpty();}
    synchronized boolean healthy(){return !failed;}
    synchronized String notice(){return failed?"Settings could not be saved. Transfers are locked off. Free storage, restart, then reconnect and enable explicitly.":(permit?"":"Transfers are off. Explicitly enable to resume retained batches. ")+text("notice","");}
    synchronized long invalidateAuthorization(){return ++epoch;}
    synchronized boolean currentAuthorization(long expected){return !failed&&epoch==expected;}
    private boolean change(Consumer<Map<String,Object>> edit, boolean enableAfter){
        permit=false;
        if(failed)return false;
        Map<String,Object> next=new HashMap<>(committed);
        try {
            edit.accept(next);
            // Never persist executable consent. This also neutralizes legacy enabled=true on success.
            next.put("enabled",false);
            if(!storage.write(next)){failed=true;++epoch;return false;}
            committed=next;permit=enableAfter;return true;
        }catch(RuntimeException e){failed=true;++epoch;return false;}
    }
    synchronized boolean setEnabled(boolean value){
        if(value&&text("accountId","").isEmpty())return false;
        return change(values->{},value);
    }
    synchronized boolean setWifiOnly(boolean value){boolean resume=enabled();return change(values->values.put("wifiOnly",value),resume);}
    synchronized boolean saveFolder(String account,String folder){boolean resume=enabled();if(!account.equals(text("accountId","")))return false;return change(values->values.put("folder-"+account,folder),resume);}
    synchronized boolean setNotice(String notice){boolean resume=enabled();return change(values->values.put("notice",notice),resume);}
    synchronized boolean pause(String notice){++epoch;return change(values->values.put("notice",notice),false);}
    synchronized boolean disconnect(){++epoch;return change(values->{values.remove("accountId");values.remove("email");values.put("notice","Disconnected locally; originals retained");},false);}
    synchronized boolean connect(String email,String account,long expected){
        if(!currentAuthorization(expected))return false;
        return change(values->{values.put("email",email);values.put("accountId",account);values.put("notice","Connected. Explicitly enable transfer for this app process; restarting pauses it.");},false);
    }
}
