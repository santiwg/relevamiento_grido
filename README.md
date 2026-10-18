# Relevamiento Grido

App web para celular que sirve para tomar los datos de entrada del modelo de simulación
(llegadas a la fila, tamaño del grupo, tipo de compra y el recorrido de cada cliente por la fila de caja,
la caja, la fila de preparación y la preparación).
Son archivos estáticos: `index.html`, `styles.css` y `app.js` (más una carpeta `lib/` con
dos librerías chicas y `sw.js` para que funcione sin señal).

## 1. Publicarla (hace falta HTTPS para instalar, compartir y mantener la pantalla encendida)

Elegí una opción:

- **Vercel:** subí esta carpeta a un repositorio de GitHub, en vercel.com elegí "Add New > Project",
  importá el repositorio y tocá Deploy (sin configurar nada). O con la consola: `npx vercel` dentro de la carpeta.
- **Netlify:** entrá a app.netlify.com/drop y arrastrá la carpeta completa.
- **GitHub Pages:** subí la carpeta a un repositorio y activá Pages en Settings.

Cuando cambies algún archivo y vuelvas a publicar, subí también el número de `VERSION` en `sw.js`
para que los celulares tomen la versión nueva.

## 2. Cómo se usa (pestaña Atención)

1. **"Llega alguien"** (arriba de todo): guarda la hora de llegada y abre una **ficha** del cliente en "Fila de caja".
   "Deshacer última llegada" está al lado.
2. **Cada ficha avanza con un toque** por 4 estados: Fila de caja > En caja > Fila de preparación > En preparación.
   Al tocar el último paso, el cliente sale del sistema y la ficha se guarda. Cada paso se puede deshacer
   (aviso "Deshacer" o la flecha de la ficha). Puede haber todas las fichas abiertas que haga falta.
3. **Seña:** cada ficha tiene un campo corto para anotar algo que distinga al cliente (por ejemplo, el color de la remera).
4. **Personas y tipo** (aparecen cuando el cliente pasa a caja): cantidad de personas del grupo y tipo de preparación
   (Ninguna, Individual, Por peso). Hay que elegir el tipo antes de sacarlo de caja. Con **Ninguna** el cliente se va al
   terminar la caja, esa hora queda como salida del sistema y no se mide preparación.
5. **"No voy a seguirla"** (solo en fila de caja): la ficha desaparece y la llegada queda con `seguida = FALSE`
   (igual cuenta para los intervalos entre llegadas).
6. **"Perdí el seguimiento"**: cierra la ficha como **incompleta**. Los tiempos que no se midieron quedan vacíos y no
   deben entrar en los promedios.
7. **Preparadores:** el contador (+ y −) registra cuántos preparadores hay y a qué hora cambió.
8. **Foto de las colas:** cada N minutos (10 por defecto; se cambia o se apaga en Ajustes) aparece una pastilla chica
   que recuerda sacar una foto de las colas con la cámara del celular. Se va sola o con "Listo".

## 3. Usarla sin Google Sheets (modo local)

Abrí el enlace en el celular. Todo se guarda en el navegador de ese celular. En la pestaña **Datos**
podés copiar cada tabla (para pegar en Excel), descargar CSV o Excel, compartir el Excel por WhatsApp/mail
y hacer un respaldo. Exportá al final de cada sesión.
En modo local la tabla `Intervalos` solo incluye las llegadas de ese celular; la completa se arma en Google Sheets.

## 4. Conectarla a Google Sheets (para juntar los datos de varios celulares)

**Si ya tenías la planilla de la versión anterior** (hojas `Llegadas`, `Personas`, `Tipo`, `Caja`, `Individuales`, `Peso`):

1. Cambiá el nombre de cada una de esas 6 hojas agregando un sufijo, por ejemplo `Llegadas_17-10`, `Caja_17-10`, etc.
   Esto es obligatorio: si queda una hoja vieja con el nombre `Llegadas`, el script se detiene con un error en vez de mezclar formatos.
2. Extensiones > Apps Script. Borrá todo y pegá el contenido de `apps-script/Code.gs` (versión 2).
3. Dejá la misma `CLAVE` que ya usaban los celulares (o poné otra y cambiala en cada celular).
4. Elegí la función `configurar` y tocá Ejecutar. Crea las hojas nuevas.
5. Implementar > **Administrar implementaciones** > lápiz > Versión: **Nueva versión** > Implementar.
   La URL `/exec` no cambia. (No uses "Nueva implementación": cambia la URL.)
6. Abrí `TU_URL/exec?clave=TU_CLAVE` en el navegador: tiene que responder `"ok":true` y `"version":2`.
7. Antes de actualizar los celulares, que cada uno termine de sincronizar lo pendiente o descargue un respaldo.
   La versión 2 guarda sus datos aparte de la anterior y no restaura respaldos de la versión 1.

**Si es una planilla nueva:**

1. Creá una planilla en Google Sheets.
2. Extensiones > Apps Script. Pegá el contenido de `apps-script/Code.gs`.
3. Cambiá `CLAVE` por una clave propia.
4. Elegí la función `configurar` y tocá Ejecutar (acepta los permisos). Crea las 4 hojas.
5. Implementar > Nueva implementación > Aplicación web. Ejecutar como: **Yo**. Acceso: **Cualquier persona**.
   Copiá la URL que termina en `/exec`.

**En la app (en todos los casos):**

1. Ajustes > Google Sheets. Pegá la URL y la clave, activá el envío y tocá "Probar conexión".
2. Para los demás celulares: "Compartir configuración" genera un enlace y un QR. En iPhone, si la app está
   instalada en la pantalla de inicio, copiá el enlace y usá "Pegar configuración" dentro de la app instalada.

Si el script de Google es de la versión anterior, la app lo avisa en el estado de sincronización y deja los datos
como pendientes (no se pierde nada).

## 5. Instalarla en la pantalla de inicio

- **Android (Chrome):** menú de tres puntos > Instalar aplicación.
- **iPhone (Safari):** Compartir > Agregar a pantalla de inicio. Hacelo **antes** de cargar datos, porque la app
  instalada guarda sus datos aparte de Safari.

## 6. Tablas que genera

| Tabla | Una fila por | Columnas |
|---|---|---|
| Llegadas | llegada (de todos los celulares) | hora_llegada, seguida (TRUE/FALSE), id_cliente, observador, dispositivo, cargado_el |
| Clientes | cliente seguido (ficha cerrada) | id_cliente, llegada, inicio_caja, fin_caja, inicio_prep, fin_prep, salida_sistema, seg_sistema, seg_cola_caja, seg_caja, seg_cola_prep, seg_prep, calidad, cierre, personas, tipo, grupo_grande, comentario, observador, dispositivo, cargado_el |
| Intervalos | llegada, ordenadas por hora | hora_llegada, intervalo_seg, intervalo_limpio_seg, posible_duplicado, duplicado_de, seguida, observador, dispositivo, id_llegada |
| Preparadores | cambio de cantidad | hora_cambio, cantidad, observador, dispositivo, cargado_el |

Detalles de las columnas:

- **Clientes:** la fila de caja empieza en `llegada` (entrada a la fila) y la de preparación en `fin_caja`.
  `seg_sistema` = salida − llegada. `seg_cola_caja` = inicio_caja − llegada. `seg_caja` = fin_caja − inicio_caja.
  `seg_cola_prep` = inicio_prep − fin_caja. `seg_prep` = fin_prep − inicio_prep.
  Cuando falta alguna hora, la columna queda vacía.
- **tipo:** 0 ninguna, 1 individual, 2 por peso. Con 0 no hay `inicio_prep`, `fin_prep`, `seg_cola_prep` ni `seg_prep`,
  y `salida_sistema` es igual a `fin_caja`. `grupo_grande` es TRUE si son 3 personas o más.
- **calidad:** `completo` si están todas las horas que corresponden; si no, `incompleto`.
  **cierre:** `completo`, `sin_preparacion` o `perdi_seguimiento`.
- **Intervalos:** la arma Google Sheets (no se edita a mano) con las llegadas de todos los celulares ordenadas por hora.
  `intervalo_seg` es contra la llegada anterior (vacío en la primera de una sesión: más de 15 minutos sin llegadas
  cuenta como otra sesión). `posible_duplicado` es TRUE si hay otra llegada de **otro celular** a menos de 3 segundos;
  `duplicado_de` dice cuál. `intervalo_limpio_seg` es igual pero salteando los duplicados marcados.
  Los duplicados solo se **marcan**: decidir cuáles descartar queda a criterio de quien analiza.
  Para recalcular a mano: menú **Relevamiento > Recalcular intervalos** en la planilla.
- **dispositivo:** identificador automático de cada celular. `observador` es opcional (Ajustes).

En Google Sheets, `Llegadas` y `Preparadores` llevan además `id` y `recibido_el`, y `Clientes` lleva `recibido_el`.
Si llega un registro con un `id` que ya existe, la fila se actualiza en vez de duplicarse.

## 7. Estructura de `app.js`

1 constantes y tablas, 2 estado y guardado, 3 utilidades, 4 armado de tablas, 5 Atención: llegadas, preparadores
y aviso de foto, 6 Atención: fichas de clientes, 7 Datos (exportar y respaldo), 8 sincronización con Sheets,
9 enlace de configuración y QR, 10 Ajustes, 11 pantalla encendida, instalación y arranque.
