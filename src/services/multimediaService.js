// src/services/multimediaService.js
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase, ensureAuthenticatedSession } from '../lib/supabase';
import { getDbConnection, getData } from '../database/db';

let ImageCompressor = null;
try {
  const compressorModule = require('react-native-compressor');
  ImageCompressor = compressorModule?.Image || compressorModule?.default?.Image || null;
} catch (e) {
  console.log('react-native-compressor not loaded natively, using image-picker compression fallback:', e.message);
}

export const COMPRESSION_PROFILES = {
  DOCUMENT: {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.8,
    label: 'Documento o comprobante',
  },
  EXPENSE_RECEIPT: {
    maxWidth: 1400,
    maxHeight: 1400,
    quality: 0.8,
    label: 'Evidencia de gasto',
  },
  ORGANIZATION_LOGO: {
    maxWidth: 600,
    maxHeight: 600,
    quality: 0.7,
    label: 'Logo de organización',
  },
  PAYMENT_RECEIPT: {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.85,
    label: 'Comprobante de pago',
  },
};

/**
 * Optimiza y comprime una imagen local según el perfil especificado
 */
export async function compressImage(sourceUri, profileKey = 'DOCUMENT') {
  const profile = COMPRESSION_PROFILES[profileKey] || COMPRESSION_PROFILES.DOCUMENT;
  if (!sourceUri) return null;

  try {
    if (ImageCompressor && typeof ImageCompressor.compress === 'function') {
      const compressedUri = await ImageCompressor.compress(sourceUri, {
        compressionMethod: 'auto',
        maxWidth: profile.maxWidth,
        maxHeight: profile.maxHeight,
        quality: profile.quality,
        returnableOutputType: 'uri',
      });
      return compressedUri || sourceUri;
    }
  } catch (err) {
    console.log('Error in ImageCompressor, falling back to source URI:', err);
  }
  return sourceUri;
}

/**
 * Abre la cámara del dispositivo para capturar una fotografía
 */
export async function capturePhotoFromCamera(profileKey = 'DOCUMENT') {
  const profile = COMPRESSION_PROFILES[profileKey] || COMPRESSION_PROFILES.DOCUMENT;

  const options = {
    mediaType: 'photo',
    cameraType: 'back',
    saveToPhotos: false,
    includeBase64: true,
    maxWidth: profile.maxWidth,
    maxHeight: profile.maxHeight,
    quality: profile.quality,
  };

  try {
    const result = await launchCamera(options);
    if (result.didCancel) {
      return { cancelled: true };
    }
    if (result.errorCode) {
      throw new Error(result.errorMessage || `Error de cámara (${result.errorCode})`);
    }

    const asset = result.assets?.[0];
    if (!asset || !asset.uri) {
      throw new Error('No se capturó ninguna imagen válida');
    }

    const compressedUri = await compressImage(asset.uri, profileKey);

    return {
      cancelled: false,
      uri: compressedUri || asset.uri,
      originalUri: asset.uri,
      base64: asset.base64,
      fileName: asset.fileName || `foto_${Date.now()}.jpg`,
      fileSize: asset.fileSize || 0,
      width: asset.width,
      height: asset.height,
      type: asset.type || 'image/jpeg',
    };
  } catch (err) {
    console.log('capturePhotoFromCamera error:', err);
    throw err;
  }
}

/**
 * Abre el selector de la galería del dispositivo
 */
export async function pickPhotoFromGallery(profileKey = 'DOCUMENT') {
  const profile = COMPRESSION_PROFILES[profileKey] || COMPRESSION_PROFILES.DOCUMENT;

  const options = {
    mediaType: 'photo',
    selectionLimit: 1,
    includeBase64: true,
    maxWidth: profile.maxWidth,
    maxHeight: profile.maxHeight,
    quality: profile.quality,
  };

  try {
    const result = await launchImageLibrary(options);
    if (result.didCancel) {
      return { cancelled: true };
    }
    if (result.errorCode) {
      throw new Error(result.errorMessage || `Error de galería (${result.errorCode})`);
    }

    const asset = result.assets?.[0];
    if (!asset || !asset.uri) {
      throw new Error('No se seleccionó ninguna imagen válida');
    }

    const compressedUri = await compressImage(asset.uri, profileKey);

    return {
      cancelled: false,
      uri: compressedUri || asset.uri,
      originalUri: asset.uri,
      base64: asset.base64,
      fileName: asset.fileName || `galeria_${Date.now()}.jpg`,
      fileSize: asset.fileSize || 0,
      width: asset.width,
      height: asset.height,
      type: asset.type || 'image/jpeg',
    };
  } catch (err) {
    console.log('pickPhotoFromGallery error:', err);
    throw err;
  }
}

/**
 * Asegura la existencia de la tabla SQLite local para evidencias
 */
export async function ensureEvidenciasLocalTable(db) {
  try {
    await db.executeSql(`CREATE TABLE IF NOT EXISTS evidencias_locales (
      id TEXT PRIMARY KEY,
      tipo_evidencia TEXT,
      tabla_relacionada TEXT,
      registro_id TEXT,
      local_path TEXT,
      file_path TEXT,
      mime_type TEXT,
      size_original REAL,
      size_compressed REAL,
      estado TEXT DEFAULT 'pendiente',
      usuario_id TEXT,
      created_at TEXT
    )`);
  } catch (e) {
    console.log('ensureEvidenciasLocalTable warning:', e);
  }
}

/**
 * Sube una evidencia al bucket privado 'Evidencias' en Supabase Storage
 * Si no hay conexión o falla la subida, la guarda localmente como pendiente.
 */
export async function uploadEvidence({
  uri,
  base64,
  tipoEvidencia, // 'documento_identidad' | 'gasto' | 'comprobante_pago' | 'organizacion'
  tablaRelacionada, // 'clients' | 'cash_movements' | 'payments' | 'organizaciones'
  registroId,
  originalSize = 0,
  compressedSize = 0,
  originalName = 'evidencia.jpg',
  mimeType = 'image/jpeg',
}) {
  const db = await getDbConnection();
  await ensureEvidenciasLocalTable(db);

  const localUuid = `evi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();

  // Generar ruta segura en Storage: carpeta por tipo, nombre con UUID (sin datos sensibles en el nombre)
  const safeRandomPart = Math.random().toString(36).slice(2, 10);
  const safeExtension = (originalName.split('.').pop() || 'jpg').toLowerCase();
  const remoteFilePath = `${tipoEvidencia}/${Date.now()}_${safeRandomPart}.${safeExtension}`;

  let isConnected = false;
  try {
    const net = await NetInfo.fetch();
    isConnected = !!net.isConnected && net.isInternetReachable !== false;
  } catch {}

  // Guardar primero localmente como pendiente (Offline-first)
  try {
    await db.executeSql(
      `INSERT OR REPLACE INTO evidencias_locales (
        id, tipo_evidencia, tabla_relacionada, registro_id, local_path, file_path,
        mime_type, size_original, size_compressed, estado, usuario_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
      [
        localUuid,
        tipoEvidencia,
        tablaRelacionada,
        String(registroId || ''),
        uri,
        remoteFilePath,
        mimeType,
        originalSize,
        compressedSize,
        null,
        nowIso,
      ]
    );
  } catch (errDb) {
    console.log('Error guardando evidencia local previa:', errDb);
  }

  if (!isConnected) {
    console.log('Sin conexión a internet. Evidencia guardada localmente para posterior sincronización:', localUuid);
    return {
      success: true,
      isOffline: true,
      localUuid,
      filePath: remoteFilePath,
      localPath: uri,
    };
  }

  try {
    const session = await ensureAuthenticatedSession();
    const currentUserId = session?.user?.id || null;

    let arrayBuffer = null;
    if (base64) {
      arrayBuffer = decode(base64);
    } else {
      const response = await fetch(uri);
      arrayBuffer = await response.arrayBuffer();
    }

    if (!arrayBuffer) {
      throw new Error('No se pudo convertir el archivo a buffer de transferencia');
    }

    // Subir a Supabase Storage en el bucket 'Evidencias'
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('Evidencias')
      .upload(remoteFilePath, arrayBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    // Registrar metadatos en tabla multimedia_evidencias
    try {
      await supabase.from('multimedia_evidencias').insert([
        {
          bucket_id: 'Evidencias',
          file_path: remoteFilePath,
          original_name: originalName,
          mime_type: mimeType,
          size_original: originalSize,
          size_compressed: compressedSize,
          usuario_id: currentUserId,
          tipo_evidencia: tipoEvidencia,
          tabla_relacionada: tablaRelacionada,
          registro_id: String(registroId || ''),
          estado_sync: 'sincronizado',
        },
      ]);
    } catch (metaErr) {
      console.log('Advertencia guardando metadatos en Supabase:', metaErr);
    }

    // Actualizar estado a 'sincronizado' en SQLite local
    try {
      await db.executeSql(
        `UPDATE evidencias_locales SET estado = 'sincronizado', usuario_id = ? WHERE id = ?`,
        [currentUserId, localUuid]
      );
    } catch {}

    return {
      success: true,
      isOffline: false,
      filePath: remoteFilePath,
      localUuid,
    };
  } catch (err) {
    console.log('Error subiendo evidencia a Storage:', err);
    // Conserva el registro local como pendiente para reintento
    return {
      success: true,
      isOffline: true,
      localUuid,
      filePath: remoteFilePath,
      localPath: uri,
      error: err.message,
    };
  }
}

/**
 * Genera una URL firmada temporal para visualizar una evidencia privada de forma segura
 */
export async function getSignedEvidenceUrl(filePath, expiresInSeconds = 3600) {
  if (!filePath) return null;

  // Si ya es una URI local de archivo (offline), retornarla directamente
  if (filePath.startsWith('file://') || filePath.startsWith('content://')) {
    return filePath;
  }

  try {
    const session = await ensureAuthenticatedSession();
    if (!session) return null;

    const { data, error } = await supabase.storage
      .from('Evidencias')
      .createSignedUrl(filePath, expiresInSeconds);

    if (error) {
      console.log('Error creando URL firmada en Supabase Storage:', error.message);
      return null;
    }

    return data?.signedUrl || null;
  } catch (e) {
    console.log('getSignedEvidenceUrl catch:', e);
    return null;
  }
}

/**
 * Sincroniza evidencias locales pendientes cuando regresa la conexión
 */
export async function syncPendingEvidencias() {
  const db = await getDbConnection();
  await ensureEvidenciasLocalTable(db);

  try {
    try {
      await db.executeSql(
        `DELETE FROM evidencias_locales WHERE tipo_evidencia IN ('comprobante_pago', 'PAYMENT_RECEIPT')`
      );
    } catch {}

    const pendientes = await getData(
      db,
      `SELECT * FROM evidencias_locales WHERE estado = 'pendiente' ORDER BY created_at ASC`
    );

    if (!pendientes || pendientes.length === 0) return { synced: 0, failed: 0 };

    const session = await ensureAuthenticatedSession();
    if (!session) return { synced: 0, failed: 0 };
    const currentUserId = session.user.id;

    let synced = 0;
    let failed = 0;

    for (const item of pendientes) {
      try {
        if (!item.local_path) {
          failed++;
          continue;
        }

        const res = await fetch(item.local_path);
        const arrayBuffer = await res.arrayBuffer();

        const { error: upErr } = await supabase.storage
          .from('Evidencias')
          .upload(item.file_path, arrayBuffer, {
            contentType: item.mime_type || 'image/jpeg',
            upsert: true,
          });

        if (upErr) throw upErr;

        await supabase.from('multimedia_evidencias').insert([
          {
            bucket_id: 'Evidencias',
            file_path: item.file_path,
            original_name: 'evidencia_sync.jpg',
            mime_type: item.mime_type || 'image/jpeg',
            size_original: item.size_original || 0,
            size_compressed: item.size_compressed || 0,
            usuario_id: currentUserId,
            tipo_evidencia: item.tipo_evidencia,
            tabla_relacionada: item.tabla_relacionada,
            registro_id: item.registro_id,
            estado_sync: 'sincronizado',
          },
        ]);

        await db.executeSql(
          `UPDATE evidencias_locales SET estado = 'sincronizado', usuario_id = ? WHERE id = ?`,
          [currentUserId, item.id]
        );
        synced++;
      } catch (itemErr) {
        console.log(`Error sincronizando evidencia pendiente ${item.id}:`, itemErr.message);
        failed++;
      }
    }

    return { synced, failed };
  } catch (e) {
    console.log('syncPendingEvidencias error general:', e);
    return { synced: 0, failed: 0 };
  }
}

