# Control de pedidos — versión 3

Esta versión incluye:

- Fecha automática del día y no editable.
- Nombre del cliente.
- Ubicación.
- Responsable mediante selector: Dila, Juan, Frida, Eric, Yare y Kevin.
- Campo de vendedor.
- Nomenclatura Bazar o Almacén.
- Folios automáticos:
  - `BAZ-AAAAMMDD-00000`
  - `ALM-AAAAMMDD-00000`
- Costo unitario por producto.
- Total automático del pedido.
- Pago `Pagado` o `Apartado`.
- Cuando es apartado, monto obligatorio y no mayor al total.
- Estados:
  - En proceso
  - Enviado
  - Con repartidor
  - Entregado
  - Finalizado
  - Cancelado
- Flujo validado: Entregado solo aparece después de Con repartidor.
- Registro de devoluciones sin cambiar la identidad del producto.
- Etiqueta con fecha, cliente, pago, ubicación, nomenclatura y productos.
- Exportación a Excel.

## Actualización desde una versión anterior

Reemplaza en GitHub:

- `index.html`
- `styles.css`
- `app.js`
- `README.md`

Conserva tu archivo actual `firebase-config.js`, porque contiene la conexión con tu proyecto Firebase.

No necesitas cambiar las reglas actuales de Firestore si ya permiten `read`, `create` y `update` para usuarios autenticados anónimamente.

## Datos anteriores

Los pedidos creados con la versión anterior seguirán apareciendo. Algunos campos nuevos se mostrarán como “No registrado” porque no existían cuando esos pedidos fueron creados.
