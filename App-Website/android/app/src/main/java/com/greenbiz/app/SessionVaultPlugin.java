package com.greenbiz.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Session tokens never enter plain preferences; the encryption key stays in Android Keystore. */
@CapacitorPlugin(name="SessionVault")
public class SessionVaultPlugin extends Plugin {
    private static final String ALIAS="greenbiz.session.aes.v1";
    private SharedPreferences preferences(){return getContext().getSharedPreferences("greenbiz.secure.sessions",Context.MODE_PRIVATE);}
    private String key(PluginCall call){String key=call.getString("key");if(key==null||!key.matches("[a-zA-Z0-9]{1,120}"))throw new IllegalArgumentException("Invalid session key");return key;}
    private SecretKey secret() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    @PluginMethod public void set(PluginCall call){try{
        String key=key(call),value=call.getString("value");if(value==null||value.length()>4096)throw new IllegalArgumentException("Invalid session value");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,secret());cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
        String encoded=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
        if(!preferences().edit().putString(key,encoded).commit())throw new IllegalStateException("Session could not be saved");call.resolve();
    }catch(Exception e){call.reject("Secure session storage failed. Please sign in again.");}}
    @PluginMethod public void get(PluginCall call){try{
        String key=key(call),encoded=preferences().getString(key,null);JSObject result=new JSObject();
        if(encoded==null){result.put("value",org.json.JSONObject.NULL);call.resolve(result);return;}
        String[] parts=encoded.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,secret(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
        result.put("value",new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));call.resolve(result);
    }catch(Exception e){call.reject("Saved session could not be opened. Please sign in again.");}}
    @PluginMethod public void remove(PluginCall call){try{if(!preferences().edit().remove(key(call)).commit())throw new IllegalStateException();call.resolve();}catch(Exception e){call.reject("Unable to clear saved session.");}}
    @PluginMethod public void exportFile(PluginCall call){try{
        String name=call.getString("name"),data=call.getString("data"),type=call.getString("type","application/json");
        if(name==null||!name.matches("[a-zA-Z0-9._-]{1,120}")||data==null||data.length()>25000000)throw new IllegalArgumentException();
        File dir=new File(getContext().getCacheDir(),"exports");if(!dir.exists()&&!dir.mkdirs())throw new IllegalStateException();
        File[] previous=dir.listFiles();if(previous!=null)for(File f:previous)if(f.lastModified()<System.currentTimeMillis()-86400000L)f.delete();
        File file=new File(dir,name);try(java.io.FileOutputStream stream=new java.io.FileOutputStream(file)){stream.write(data.getBytes(StandardCharsets.UTF_8));}
        Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
        Intent share=new Intent(Intent.ACTION_SEND);share.setType(type);share.putExtra(Intent.EXTRA_STREAM,uri);share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().runOnUiThread(()->{try{getActivity().startActivity(Intent.createChooser(share,"Export GreenBiz records"));call.resolve();}catch(Exception e){call.reject("No application is available to save or share this file.");}});
    }catch(Exception e){call.reject("Unable to export records. Please try a smaller export.");}}
}
