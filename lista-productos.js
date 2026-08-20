import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getFirestore, collection, doc, getDoc, onSnapshot, orderBy, query, writeBatch, arrayUnion, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const $ = selector => document.querySelector(selector);
let pedidos = [];
const seleccionados = new Set();
let detenerEscucha = null;
let perfilActual = null;

const ESTADOS = {
  EN_PROCESO: "En proceso", CLASIFICADO: "Clasificado", ENVIADO: "Enviado",
  CON_REPARTIDOR: "Ingresado a punto de venta", ENTREGADO: "Entregado",
  FINALIZADO: "Finalizado", CANCELADO: "Cancelado", CON_DEVOLUCION: "Con devoluciÃ³n"
};

function escapeHtml(valor = "") {
  return String(valor).replace(/[&<>"']/g, caracter => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[caracter]);
}
function normalizar(valor = "") { return String(valor).trim().toLocaleLowerCase("es-MX"); }
function moneda(valor) { return Number(valor || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" }); }
function totalProductosPedido(pedido) {
  return (pedido.productos || []).reduce((suma, p) => suma + Number(p.cantidad || 0) * Number(p.costo || 0), 0);
}
function pagosPedido(pedido) {
  if (Array.isArray(pedido.pagos)) return pedido.pagos;
  return Number(pedido.montoApartado || 0) > 0 ? [{ monto: Number(pedido.montoApartado) }] : [];
}
function totalPagado(pedido) { return pagosPedido(pedido).reduce((suma, pago) => suma + Number(pago.monto || 0), 0); }
function importeDevoluciones(pedido) {
  return (pedido.devoluciones || []).reduce((total, devolucion) => {
    if (Number.isFinite(Number(devolucion.importeAjuste))) return total + Number(devolucion.importeAjuste);
    return total + (devolucion.productos || []).reduce((suma, p) =>
      suma + Number(p.cantidadDevuelta || 0) * Number(p.costo || 0), 0);
  }, 0);
}
function totalAjustado(pedido) {
  return Math.max(0, Number(pedido.total || totalProductosPedido(pedido)) - importeDevoluciones(pedido));
}
function saldoPendiente(pedido) { return Math.max(0, totalAjustado(pedido) - totalPagado(pedido)); }
function claveProducto(producto = {}) {
  return normalizar(producto.clave) || `nombre:${normalizar(producto.nombre || "Producto sin nombre")}`;
}
function consolidarProductos(productos = []) {
  const mapa = new Map();
  productos.forEach(producto => {
    const clave = claveProducto(producto);
    const actual = mapa.get(clave) || { clave: producto.clave || "Sin SKU", nombre: producto.nombre || "Producto sin nombre", cantidad: 0 };
    actual.cantidad += Number(producto.cantidad || 0);
    mapa.set(clave, actual);
  });
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
function coincidePedido(pedido, busqueda) {
  const cliente = normalizar(pedido.nombreCliente);
  const valoresProducto = (pedido.productos || []).flatMap(p => [normalizar(p.clave), normalizar(p.nombre)]);
  return cliente.includes(busqueda) || valoresProducto.some(valor => valor.includes(busqueda));
}
function tablaProductos(productos) {
  return `<table class="product-table"><thead><tr><th>SKU</th><th>Producto</th><th>Cantidad</th></tr></thead><tbody>
    ${productos.map(p => `<tr><td class="product-code">${escapeHtml(p.clave)}</td><td>${escapeHtml(p.nombre)}</td><td class="quantity">${Number(p.cantidad).toLocaleString("es-MX")}</td></tr>`).join("")}
  </tbody></table>`;
}

function pedidosSeleccionadosActivos() {
  return pedidos.filter(p => seleccionados.has(p.idFirestore) && p.estado !== "FINALIZADO" && p.eliminado !== true);
}

function tienePermiso(nombre) {
  const permisoExplicito = perfilActual?.permisos?.[nombre];
  if (typeof permisoExplicito === "boolean") return permisoExplicito;
  if (perfilActual?.rol === "admin") return true;
  return nombre === "agregarPagos" && perfilActual?.rol === "vendedor";
}

function aplicarPermisos() {
  const puedePagar = tienePermiso("agregarPagos");
  const puedeCambiar = tienePermiso("cambiarEstado");
  $("#btnPagoMasivo").classList.toggle("hidden", !puedePagar);
  $("#btnEstadoMasivo").classList.toggle("hidden", !puedeCambiar);
  $("#mensajePermisos").textContent = puedePagar || puedeCambiar
    ? "Solo se muestran las acciones permitidas para tu perfil."
    : "Tu perfil solo puede consultar y seleccionar pedidos.";
}

function renderResumenSeleccion() {
  const lista = pedidosSeleccionadosActivos();
  const productos = consolidarProductos(lista.flatMap(p => p.productos || []));
  const piezas = productos.reduce((suma, p) => suma + p.cantidad, 0);
  const saldo = lista.reduce((suma, p) => suma + saldoPendiente(p), 0);
  $("#pedidosSeleccionados").textContent = lista.length.toLocaleString("es-MX");
  $("#productosSeleccionados").textContent = productos.length.toLocaleString("es-MX");
  $("#piezasSeleccionadas").textContent = piezas.toLocaleString("es-MX");
  $("#saldoSeleccionado").textContent = moneda(saldo);
  const resumen = $("#resumenSeleccion");
  resumen.classList.toggle("hidden", lista.length === 0);
  resumen.innerHTML = lista.length ? `<h2>Productos consolidados de los pedidos seleccionados</h2>${tablaProductos(productos)}` : "";
  $("#accionesSeleccion").classList.toggle("hidden", lista.length === 0);
  aplicarPermisos();
}

function render() {
  const busqueda = normalizar($("#buscadorLista").value);
  if (!busqueda) {
    $("#listasProductos").innerHTML = "";
    $("#instruccionBusqueda").classList.remove("hidden");
    $("#sinResultadosLista").classList.add("hidden");
    renderResumenSeleccion();
    return;
  }
  const resultados = pedidos.filter(p => p.eliminado !== true && coincidePedido(p, busqueda));
  $("#instruccionBusqueda").classList.add("hidden");
  $("#sinResultadosLista").classList.toggle("hidden", resultados.length > 0);
  $("#listasProductos").innerHTML = resultados.map(pedido => {
    const finalizado = pedido.estado === "FINALIZADO";
    const seleccionado = seleccionados.has(pedido.idFirestore) && !finalizado;
    return `<article class="product-group ${finalizado ? "finalized" : ""} ${seleccionado ? "selected" : ""}">
      <header class="group-head">
        <label class="order-select">
          <input class="order-checkbox" type="checkbox" data-id="${escapeHtml(pedido.idFirestore)}" ${seleccionado ? "checked" : ""} ${finalizado ? "disabled" : ""}>
          <span><h2>${escapeHtml(pedido.folio || "Pedido sin folio")}</h2><p>${escapeHtml(pedido.nombreCliente || "Cliente no registrado")} Â· ${escapeHtml(pedido.fechaPedido || "Sin fecha")}</p>
          <small class="status-badge ${finalizado ? "finalized" : ""}">${escapeHtml(ESTADOS[pedido.estado] || pedido.estado || "Sin estado")}</small></span>
        </label>
        <div class="order-money"><span>Total<strong>${moneda(totalAjustado(pedido))}</strong></span><span>Pagado<strong>${moneda(totalPagado(pedido))}</strong></span><span class="pending">Saldo restante<strong>${moneda(saldoPendiente(pedido))}</strong></span></div>
      </header>${tablaProductos(consolidarProductos(pedido.productos || []))}
    </article>`;
  }).join("");
  document.querySelectorAll(".order-checkbox:not(:disabled)").forEach(check => check.addEventListener("change", () => {
    if (check.checked) seleccionados.add(check.dataset.id); else seleccionados.delete(check.dataset.id);
    render();
  }));
  renderResumenSeleccion();
}

function fechaSoloDia(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function abrirPagoMasivo() {
  if (!tienePermiso("agregarPagos")) return alert("Tu perfil no puede agregar pagos.");
  const lista = pedidosSeleccionadosActivos().filter(p => saldoPendiente(p) > 0.009);
  const saldoTotal = lista.reduce((suma, p) => suma + saldoPendiente(p), 0);
  if (!lista.length) return alert("Los pedidos seleccionados no tienen saldo pendiente.");
  $("#formPagoMasivo").reset();
  $("#montoPagoMasivo").max = String(saldoTotal);
  $("#fechaPagoMasivo").value = fechaSoloDia();
  $("#resumenPagoMasivo").textContent = `${lista.length} pedido${lista.length === 1 ? "" : "s"} Â· Saldo mÃ¡ximo ${moneda(saldoTotal)}`;
  $("#modalPagoMasivo").showModal();
}

async function guardarPagoMasivo(event) {
  event.preventDefault();
  if (!tienePermiso("agregarPagos")) return;
  const lista = pedidosSeleccionadosActivos().filter(p => saldoPendiente(p) > 0.009);
  const saldoTotal = lista.reduce((suma, p) => suma + saldoPendiente(p), 0);
  const monto = Number($("#montoPagoMasivo").value);
  const metodo = $("#metodoPagoMasivo").value;
  const fecha = $("#fechaPagoMasivo").value;
  if (!Number.isFinite(monto) || monto <= 0) return alert("Escribe un monto vÃ¡lido.");
  if (monto > saldoTotal + 0.009) return alert(`El pago no puede superar el saldo de ${moneda(saldoTotal)}.`);
  if (!metodo || !fecha) return alert("Selecciona el método y la fecha del pago.");

  const boton = $("#btnGuardarPagoMasivo");
  boton.disabled = true;
  boton.textContent = "Registrandoâ€¦";
  try {
    const batch = writeBatch(db);
    const idGrupo = crypto.randomUUID();
    let restante = monto;
    for (const pedido of lista) {
      if (restante <= 0.009) break;
      const aplicado = Math.min(restante, saldoPendiente(pedido));
      const nuevoPagado = totalPagado(pedido) + aplicado;
      const nuevoEstatus = nuevoPagado >= totalAjustado(pedido) - 0.009 ? "PAGADO" : "APARTADO";
      const pago = { id: crypto.randomUUID(), idGrupo, monto: aplicado, metodo, fecha, fechaISO: new Date().toISOString() };
      batch.update(doc(db, "surtidos", pedido.idFirestore), {
        pagos: arrayUnion(pago), estatusPago: nuevoEstatus, montoApartado: nuevoPagado,
        metodoPago: metodo, fechaPago: fecha, actualizadoEn: serverTimestamp(),
        historial: arrayUnion({ tipo: "PAGO_AGREGADO", detalle: `${moneda(aplicado)} por ${metodo === "EFECTIVO" ? "Efectivo" : "Transferencia"} desde selecciÃ³n mÃºltiple`, fechaISO: new Date().toISOString() })
      });
      restante -= aplicado;
    }
    await batch.commit();
    $("#modalPagoMasivo").close();
    alert(`Pago de ${moneda(monto)} registrado correctamente.`);
  } catch (error) {
    console.error(error);
    alert("No se pudo registrar el pago en los pedidos seleccionados.");
  } finally {
    boton.disabled = false;
    boton.textContent = "Registrar pago";
  }
}

function abrirEstadoMasivo() {
  if (!tienePermiso("cambiarEstado")) return alert("Tu perfil no puede cambiar estatus.");
  const lista = pedidosSeleccionadosActivos();
  if (!lista.length) return;
  $("#formEstadoMasivo").reset();
  $("#resumenEstadoMasivo").textContent = `${lista.length} pedido${lista.length === 1 ? "" : "s"} seleccionado${lista.length === 1 ? "" : "s"}`;
  $("#modalEstadoMasivo").showModal();
}

async function guardarEstadoMasivo(event) {
  event.preventDefault();
  if (!tienePermiso("cambiarEstado")) return;
  const lista = pedidosSeleccionadosActivos();
  const nuevoEstado = $("#nuevoEstadoMasivo").value;
  if (!nuevoEstado) return alert("Selecciona el nuevo estatus.");
  if (nuevoEstado === "FINALIZADO") {
    const pendientes = lista.filter(p => saldoPendiente(p) > 0.009);
    if (pendientes.length) return alert(`${pendientes.length} pedido(s) todavÃ­a tienen saldo pendiente y no pueden finalizarse.`);
  }
  if (!confirm(`Â¿Aplicar el estatus â€œ${ESTADOS[nuevoEstado]}â€ a ${lista.length} pedido(s)?`)) return;

  const boton = $("#btnGuardarEstadoMasivo");
  boton.disabled = true;
  boton.textContent = "Actualizandoâ€¦";
  try {
    const batch = writeBatch(db);
    lista.forEach(pedido => {
      const cambios = {
        estado: nuevoEstado, actualizadoEn: serverTimestamp(),
        historial: arrayUnion({ tipo: "ESTADO_CAMBIADO", detalle: `Estatus cambiado de ${ESTADOS[pedido.estado] || pedido.estado} a ${ESTADOS[nuevoEstado]} desde selecciÃ³n mÃºltiple`, fechaISO: new Date().toISOString() })
      };
      if (nuevoEstado === "FINALIZADO") cambios.finalizadoEn = serverTimestamp();
      batch.update(doc(db, "surtidos", pedido.idFirestore), cambios);
    });
    await batch.commit();
    $("#modalEstadoMasivo").close();
    seleccionados.clear();
    render();
    alert("Estatus actualizado correctamente.");
  } catch (error) {
    console.error(error);
    alert("No se pudo cambiar el estatus de los pedidos seleccionados.");
  } finally {
    boton.disabled = false;
    boton.textContent = "Actualizar pedidos";
  }
}

async function cargarPerfil(user) {
  const snapshot = await getDoc(doc(db, "usuarios", user.uid));
  if (!snapshot.exists()) throw new Error("Tu cuenta no tiene un perfil autorizado.");
  const perfil = snapshot.data();
  if (perfil.activo === false) throw new Error("Esta cuenta estÃ¡ desactivada.");
  return perfil;
}

onAuthStateChanged(auth, async user => {
  const mensaje = $("#mensajeAcceso");
  if (!user) {
    mensaje.classList.add("error");
    mensaje.innerHTML = `Debes iniciar sesiÃ³n para consultar esta lista. <a href="index.html">Ir al inicio de sesiÃ³n</a>.`;
    return;
  }
  try {
    perfilActual = await cargarPerfil(user);
    $("#nombreUsuario").textContent = perfilActual.nombre || user.email;
    $("#rolUsuario").textContent = perfilActual.rol === "admin" ? "Administrador" : (perfilActual.rol || "Usuario");
    aplicarPermisos();
    mensaje.classList.add("hidden");
    $("#contenidoReporte").classList.remove("hidden");
    detenerEscucha = onSnapshot(query(collection(db, "surtidos"), orderBy("creadoEn", "desc")), snapshot => {
      pedidos = snapshot.docs.map(documento => ({ idFirestore: documento.id, ...documento.data() }));
      [...seleccionados].forEach(id => {
        const pedido = pedidos.find(item => item.idFirestore === id);
        if (!pedido || pedido.estado === "FINALIZADO" || pedido.eliminado === true) seleccionados.delete(id);
      });
      render();
    }, error => {
      console.error(error);
      mensaje.textContent = "No se pudieron leer los pedidos. Revisa las reglas de Firebase.";
      mensaje.classList.remove("hidden"); mensaje.classList.add("error");
    });
  } catch (error) {
    mensaje.textContent = error.message || "No se pudo validar la cuenta.";
    mensaje.classList.remove("hidden"); mensaje.classList.add("error");
  }
});

$("#buscadorLista").addEventListener("input", render);
$("#btnLimpiarSeleccion").addEventListener("click", () => { seleccionados.clear(); render(); });
$("#btnPagoMasivo").addEventListener("click", abrirPagoMasivo);
$("#btnEstadoMasivo").addEventListener("click", abrirEstadoMasivo);
$("#formPagoMasivo").addEventListener("submit", guardarPagoMasivo);
$("#formEstadoMasivo").addEventListener("submit", guardarEstadoMasivo);
document.querySelectorAll("[data-close]").forEach(boton => boton.addEventListener("click", () => $("#" + boton.dataset.close).close()));
$("#btnVolver").addEventListener("click", () => {
  const origenMismoSitio = document.referrer && new URL(document.referrer).origin === window.location.origin;
  if (origenMismoSitio && window.history.length > 1) window.history.back();
  else window.location.replace("index.html");
});
window.addEventListener("beforeunload", () => detenerEscucha?.());