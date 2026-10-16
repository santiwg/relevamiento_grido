# Relevamiento Grido

App web para celular que sirve para tomar los datos de entrada del modelo de simulación
(llegadas a la fila, tamaño del grupo, tipo de compra, tiempos de caja y de preparación).
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

## 2. Usarla sin Google Sheets (modo local)

Abrí el enlace en el celular. Todo se guarda en el navegador de ese celular. En la pestaña **Datos**
podés copiar cada tabla (para pegar en Excel), descargar CSV o Excel, compartir el Excel por WhatsApp/mail
y hacer un respaldo. Exportá al final de cada sesión.

## 3. Conectarla a Google Sheets (para juntar los datos de varios celulares)

1. Creá una planilla nueva en Google Sheets.
2. Extensiones > Apps Script. Pegá el contenido de `apps-script/Code.gs`.
3. Cambiá `CLAVE` por una clave propia.
4. Elegí la función `configurar` y tocá Ejecutar (acepta los permisos). Crea las 6 hojas.
5. Implementar > Nueva implementación > Aplicación web. Ejecutar como: **Yo**. Acceso: **Cualquier persona**.
   Copiá la URL que termina en `/exec`.
6. En la app: Ajustes > Google Sheets. Pegá la URL y la clave, activá el envío y tocá "Probar conexión".
7. Para los demás celulares: "Compartir configuración" genera un enlace y un QR. En iPhone, si la app está
   instalada en la pantalla de inicio, copiá el enlace y usá "Pegar configuración" dentro de la app instalada.

## 4. Instalarla en la pantalla de inicio

- **Android (Chrome):** menú de tres puntos > Instalar aplicación.
- **iPhone (Safari):** Compartir > Agregar a pantalla de inicio. Hacelo **antes** de cargar datos, porque la app
  instalada guarda sus datos aparte de Safari.

## 5. Tablas que genera

| Tabla | Columnas |
|---|---|
| Llegadas | hora_llegada, intervalo_seg, cargado_el, observador |
| Personas | personas, cargado_el, observador |
| Tipo | tipo (0 ninguna, 1 individual, 2 por peso), cargado_el, observador |
| Caja | duracion_seg, inicio, fin, cargado_el, observador |
| Individuales | duracion_seg, personas, grupo_grande (TRUE si son 3 o más), inicio, fin, cargado_el, observador |
| Peso | duracion_seg, inicio, fin, cargado_el, observador |

`observador` es opcional (Ajustes). En Google Sheets cada fila lleva además `id` (evita duplicados) y `recibido_el`.

## 6. Estructura de `app.js`

1 constantes y tablas, 2 estado y guardado, 3 utilidades, 4 armado de tablas, 5 Llegadas, 6 Atención,
7 Datos (exportar y respaldo), 8 sincronización con Sheets, 9 enlace de configuración y QR, 10 Ajustes,
11 pantalla encendida, instalación y arranque.
