package org.studentorganizer.capture;

import org.junit.Test;
import org.studentorganizer.capture.transfer.HttpDriveGateway;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import static org.junit.Assert.*;

public class TransferSettingsTest {
    /** Models Android's memory-first commit, including an ambiguous false after durable success. */
    static final class Disk implements TransferSettings.Storage {
        Map<String,Object> disk=new HashMap<>(), memory=new HashMap<>();
        boolean fail, throwWrite, persistedDespiteFailure, corruptRead;
        int writes;
        Disk(){disk.put("accountId","fictional-account");disk.put("email","fictional@example.invalid");disk.put("enabled",true);memory.putAll(disk);}
        public Map<String,Object> read(){if(corruptRead)throw new IllegalStateException("fictional corrupt settings");return new HashMap<>(memory);}
        public boolean write(Map<String,Object> values){writes++;memory=new HashMap<>(values);if(throwWrite)throw new IllegalStateException("fictional full storage");if(!fail||persistedDespiteFailure)disk=new HashMap<>(values);return !fail;}
        Disk restart(){Disk next=new Disk();next.disk=new HashMap<>(disk);next.memory=new HashMap<>(disk);return next;}
    }
    private void noRequest(TransferSettings settings)throws Exception{
        AtomicInteger tokens=new AtomicInteger(),requests=new AtomicInteger();
        HttpDriveGateway gateway=new HttpDriveGateway(()->{tokens.incrementAndGet();return "fictional-token";},settings::enabled,(method,url,headers,body)->{requests.incrementAndGet();return new HttpDriveGateway.Response(200,"{}",null,null);});
        assertThrows(IOException.class,gateway::generateId);
        assertThrows(IOException.class,()->gateway.createFolder("fictional-folder","Fictional"));
        assertEquals(0,tokens.get());assertEquals(0,requests.get());
    }
    @Test public void legacyDurableConsentNeverStartsNetworkAfterRestart()throws Exception{
        Disk disk=new Disk();TransferSettings settings=new TransferSettings(disk);noRequest(settings);
        assertTrue(settings.setEnabled(true));assertTrue(settings.enabled());assertEquals(false,disk.disk.get("enabled"));
        noRequest(new TransferSettings(disk.restart()));
    }
    @Test public void eachFailedMutationLocksOffDespiteDirtyMemoryAndOldDisk()throws Exception{
        List<Function<TransferSettings,Boolean>> mutations=Arrays.asList(
            s->s.setEnabled(true),s->s.setEnabled(false),TransferSettings::disconnect,
            s->s.pause("fictional account pause"),s->s.setWifiOnly(false),
            s->s.saveFolder("fictional-account","not-durable-folder"),s->s.setNotice("fictional notice"),
            s->s.connect("new@example.invalid","new-account",s.invalidateAuthorization()));
        for(Function<TransferSettings,Boolean> mutation:mutations){
            Disk disk=new Disk();TransferSettings settings=new TransferSettings(disk);assertTrue(settings.setEnabled(true));
            Map<String,Object> before=new HashMap<>(disk.disk);disk.fail=true;
            assertFalse(mutation.apply(settings));assertFalse(settings.healthy());noRequest(settings);
            assertEquals(before,disk.disk);assertEquals("",settings.text("folder-fictional-account",""));
            assertEquals("fictional-account",settings.text("accountId",""));
            disk.fail=false;int writes=disk.writes;
            assertFalse(settings.setNotice("later successful-looking update"));assertFalse(settings.setEnabled(true));
            assertEquals(writes,disk.writes);noRequest(settings);noRequest(new TransferSettings(disk.restart()));
        }
    }
    @Test public void ambiguousFalseAfterActualPersistenceStillRequiresNewProcessConsent()throws Exception{
        Disk disk=new Disk();TransferSettings settings=new TransferSettings(disk);disk.fail=true;disk.persistedDespiteFailure=true;
        assertFalse(settings.setEnabled(true));noRequest(settings);noRequest(new TransferSettings(disk.restart()));
    }
    @Test public void failedFolderSaveCannotBeUsedOnRetryOrCreateRemoteFolder()throws Exception{
        Disk disk=new Disk();TransferSettings settings=new TransferSettings(disk);assertTrue(settings.setEnabled(true));disk.fail=true;
        assertFalse(settings.saveFolder("fictional-account","memory-only-id"));assertEquals("memory-only-id",disk.memory.get("folder-fictional-account"));
        assertEquals("",settings.text("folder-fictional-account",""));noRequest(settings);
        TransferSettings restarted=new TransferSettings(disk.restart());assertEquals("",restarted.text("folder-fictional-account",""));noRequest(restarted);
    }
    @Test public void disconnectInvalidatesCallbacksEvenWhenNoWriteCanSucceed()throws Exception{
        Disk disk=new Disk();TransferSettings settings=new TransferSettings(disk);assertTrue(settings.setEnabled(true));long callback=settings.invalidateAuthorization();disk.fail=true;
        assertFalse(settings.disconnect());assertFalse(settings.currentAuthorization(callback));
        assertFalse(settings.connect("late@example.invalid","late-account",callback));noRequest(settings);
        assertFalse(new TransferSettings(disk.restart()).currentAuthorization(callback));
    }
    @Test public void epochInvalidationNeedsNoStorageAndBlocksStaleAccountCallback(){
        Disk disk=new Disk();TransferSettings settings=new TransferSettings(disk);long stale=settings.invalidateAuthorization();disk.fail=true;int writes=disk.writes;
        long current=settings.invalidateAuthorization();assertNotEquals(stale,current);assertEquals(writes,disk.writes);
        assertFalse(settings.connect("late@example.invalid","late-account",stale));assertEquals(writes,disk.writes);
    }
    @Test public void successfulConfigurationPreservesOnlyCurrentProcessConsent(){
        Disk disk=new Disk();TransferSettings settings=new TransferSettings(disk);assertTrue(settings.setEnabled(true));
        assertTrue(settings.setWifiOnly(false));assertTrue(settings.saveFolder("fictional-account","durable-folder"));assertTrue(settings.setNotice("Saved"));assertTrue(settings.enabled());
        TransferSettings restarted=new TransferSettings(disk.restart());assertFalse(restarted.enabled());assertFalse(restarted.flag("wifiOnly",true));assertEquals("durable-folder",restarted.text("folder-fictional-account",""));
    }
    @Test public void successfulDisconnectClearsDurableIdentityAndConsent()throws Exception{
        Disk disk=new Disk();TransferSettings settings=new TransferSettings(disk);assertTrue(settings.setEnabled(true));assertTrue(settings.saveFolder("fictional-account","retained-folder"));
        assertTrue(settings.disconnect());assertFalse(disk.disk.containsKey("accountId"));assertFalse(disk.disk.containsKey("email"));noRequest(settings);
        TransferSettings restarted=new TransferSettings(disk.restart());assertEquals("",restarted.text("accountId",""));assertEquals("retained-folder",restarted.text("folder-fictional-account",""));assertFalse(restarted.setEnabled(true));noRequest(restarted);
    }
    @Test public void readAndWriteExceptionsFailClosedWithoutNetwork()throws Exception{
        Disk corrupt=new Disk();corrupt.corruptRead=true;TransferSettings badRead=new TransferSettings(corrupt);assertFalse(badRead.setEnabled(true));noRequest(badRead);
        Disk disk=new Disk();TransferSettings badWrite=new TransferSettings(disk);assertTrue(badWrite.setEnabled(true));disk.throwWrite=true;assertFalse(badWrite.setNotice("cannot write"));noRequest(badWrite);noRequest(new TransferSettings(disk.restart()));
    }
}
