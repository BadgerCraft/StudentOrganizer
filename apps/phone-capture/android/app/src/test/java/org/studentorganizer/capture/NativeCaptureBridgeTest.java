package org.studentorganizer.capture;

import android.graphics.Bitmap;
import android.util.Base64;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import java.io.*;
import java.lang.reflect.*;
import java.util.UUID;
import static org.junit.Assert.*;

/** No camera account, Drive, or document-provider traffic. */
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@RunWith(RobolectricTestRunner.class)
@Config(sdk=35)
public class NativeCaptureBridgeTest {
    private MainActivity activity;
    private Object bridge;
    @Before public void setup() throws Exception {
        activity=Robolectric.buildActivity(MainActivity.class).get();
        Class<?> type=Class.forName(MainActivity.class.getName()+"$Bridge");
        Constructor<?> constructor=type.getDeclaredConstructor(MainActivity.class);constructor.setAccessible(true);bridge=constructor.newInstance(activity);
    }
    private String call(String method,Class<?>[] types,Object... args)throws Exception {Method m=bridge.getClass().getDeclaredMethod(method,types);m.setAccessible(true);return (String)m.invoke(bridge,args);}
    private JSONObject receipt(String method,Class<?>[] types,Object... args)throws Exception{return new JSONObject(call(method,types,args));}
    @Test public void chunkWriterRejectsOversizeMismatchAndAllowsRetry()throws Exception{
        assertFalse(receipt("beginZip",new Class[]{long.class,String.class},256L*1024*1024+1,"fictional-package").getBoolean("accepted"));
        JSONObject start=receipt("beginZip",new Class[]{long.class,String.class},3L,"fictional-package");String token=start.getString("token");
        assertFalse(receipt("beginZip",new Class[]{long.class,String.class},3L,"fictional-package").getBoolean("accepted"));
        assertFalse(receipt("appendZip",new Class[]{String.class,String.class},"wrong", "AQID").getBoolean("accepted"));
        assertTrue(receipt("appendZip",new Class[]{String.class,String.class},token,"AQID").getBoolean("accepted"));
        assertFalse(receipt("appendZip",new Class[]{String.class,String.class},token,"AQ==").getBoolean("accepted"));
        assertFalse(receipt("finishZip",new Class[]{String.class,String.class,long.class,String.class},token,"fictional-package",1L,"drive").getBoolean("accepted"));
        assertTrue(receipt("cancelZip",new Class[]{String.class},token).getBoolean("accepted"));
        assertTrue(receipt("beginZip",new Class[]{long.class,String.class},3L,"fictional-package").getBoolean("accepted"));
    }
    @Test public void recoveredCameraOriginalRequiresAckAndIsNeverDeleted()throws Exception{
        File directory=new File(activity.getFilesDir(),"camera-originals");directory.mkdirs();String id=UUID.randomUUID().toString();File file=new File(directory,id+".jpg");
        Bitmap image=Bitmap.createBitmap(2,2,Bitmap.Config.ARGB_8888);try(FileOutputStream out=new FileOutputStream(file)){image.compress(Bitmap.CompressFormat.JPEG,90,out);out.getFD().sync();}image.recycle();
        activity.getSharedPreferences("camera-state",0).edit().putString("batch-"+id,"batch").putString("submission-"+id,"submission").commit();
        assertEquals(0,new JSONArray(call("getPendingCaptures",new Class[]{String.class,String.class},"other-batch","submission")).length());
        assertFalse(receipt("readPendingCapture",new Class[]{String.class,String.class,String.class},id,"other-batch","submission").getBoolean("accepted"));
        assertFalse(receipt("acknowledgeCapture",new Class[]{String.class,String.class,String.class},id,"batch","other-submission").getBoolean("accepted"));
        assertFalse(receipt("startCamera",new Class[]{String.class,String.class,int.class},"other-batch","other-submission",10).getBoolean("accepted"));
        JSONArray pending=new JSONArray(call("getPendingCaptures",new Class[]{String.class,String.class},"batch","submission"));assertEquals(1,pending.length());
        JSONObject photo=new JSONObject(call("readPendingCapture",new Class[]{String.class,String.class,String.class},id,"batch","submission"));assertTrue(photo.getString("dataUrl").startsWith("data:image/jpeg;base64,"));
        assertFalse(receipt("readPendingCapture",new Class[]{String.class,String.class,String.class},"../bad","batch","submission").getBoolean("accepted"));
        assertTrue(receipt("acknowledgeCapture",new Class[]{String.class,String.class,String.class},id,"batch","submission").getBoolean("accepted"));
        assertEquals(0,new JSONArray(call("getPendingCaptures",new Class[]{String.class,String.class},"batch","submission")).length());assertTrue(file.exists());
    }
    @Test public void recoveryUsesDurableCaptureSequenceInsteadOfFilesystemOrder()throws Exception{
        File directory=new File(activity.getFilesDir(),"camera-originals");directory.mkdirs();String first=UUID.randomUUID().toString(),second=UUID.randomUUID().toString();
        Bitmap image=Bitmap.createBitmap(2,2,Bitmap.Config.ARGB_8888);
        for(String id:new String[]{second,first}){try(FileOutputStream out=new FileOutputStream(new File(directory,id+".jpg"))){image.compress(Bitmap.CompressFormat.JPEG,90,out);}}
        image.recycle();activity.getSharedPreferences("camera-state",0).edit().putString("batch-"+first,"batch").putString("submission-"+first,"submission").putLong("order-"+first,1).putString("batch-"+second,"batch").putString("submission-"+second,"submission").putLong("order-"+second,2).commit();
        JSONArray recovered=new JSONArray(call("getPendingCaptures",new Class[]{String.class,String.class},"batch","submission"));assertEquals(first,recovered.getJSONObject(0).getString("id"));assertEquals(second,recovered.getJSONObject(1).getString("id"));
        assertFalse(receipt("discardPendingCapture",new Class[]{String.class,String.class,String.class},first,"batch","wrong").getBoolean("accepted"));
        assertTrue(receipt("discardPendingCapture",new Class[]{String.class,String.class,String.class},first,"batch","submission").getBoolean("accepted"));assertTrue(new File(directory,first+".jpg").isFile());
    }

}
