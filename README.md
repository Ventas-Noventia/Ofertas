# Control de surtidos

Primera versión del sistema para:

- Crear surtidos con uno o varios productos.
- Guardarlos como "En proceso".
- Confirmar que ya fueron descontados en SICAR.
- Generar un folio automático tipo `S-123456`.
- Imprimir una etiqueta básica.
- Consultar surtidos desde varios dispositivos.
- Registrar devoluciones, motivo y productos devueltos.
- Confirmar que el producto fue reincorporado en SICAR.
- Reimprimir la etiqueta original del surtido.

## 1. Configurar Firebase

1. Entra a Firebase Console y abre tu proyecto.
2. Crea una aplicación Web.
3. Copia la configuración de Firebase.
4. Abre `firebase-config.js` y reemplaza los valores.
5. En **Firestore Database**, crea la base de datos.
6. En **Authentication > Sign-in method**, activa **Anonymous**.
7. En **Firestore > Rules**, pega el contenido de `firestore.rules` y publica las reglas.

## 2. Probar en la computadora

No abras `index.html` directamente con doble clic porque usa módulos JavaScript.

En VS Code:
1. Instala la extensión **Live Server**.
2. Abre la carpeta del proyecto.
3. Clic derecho en `index.html`.
4. Selecciona **Open with Live Server**.

También puedes ejecutar:

```bash
python3 -m http.server 8000
```

Y abrir:

```text
http://localhost:8000
```

## 3. Publicar en GitHub Pages

1. Sube todos los archivos al repositorio.
2. Abre **Settings > Pages**.
3. En Source selecciona **Deploy from a branch**.
4. Selecciona la rama `main` y la carpeta `/root`.
5. Guarda.

## Importante

La aplicación no modifica SICAR automáticamente. Antes de finalizar un surtido exige confirmar que los productos ya se descontaron manualmente en SICAR. En una devolución exige confirmar que ya se reincorporaron.

No se requieren perfiles visibles. Firebase Authentication crea una sesión anónima para proteger el acceso básico a Firestore.

## Colección de Firestore

La aplicación crea automáticamente la colección:

```text
surtidos
```

Cada documento contiene folio, responsable, productos, estado, fechas, devoluciones e historial.


## Exportar todos los pedidos

En la pantalla principal se agregó el botón **Exportar pedidos**.

Genera un archivo Excel con tres hojas:

1. `Pedidos`: resumen de cada folio.
2. `Productos`: todos los productos incluidos en cada pedido.
3. `Devoluciones`: productos devueltos, cantidades, motivos y observaciones.

El archivo se descarga con un nombre como:

```text
pedidos-2026-07-17.xlsx
```

La exportación incluye todos los registros cargados desde Firestore.
