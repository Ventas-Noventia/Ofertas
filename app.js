import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, getDoc, setDoc, onSnapshot,
  serverTimestamp, query, orderBy, arrayUnion, writeBatch
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth, createUserWithEmailAndPassword,
  deleteUser, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const storage = getStorage(firebaseApp);
const firebaseUsuariosApp = initializeApp(firebaseConfig, "gestion-usuarios");
const authUsuarios = getAuth(firebaseUsuariosApp);

const $ = selector => document.querySelector(selector);
const lista = $("#listaSurtidos");
const modalSurtido = $("#modalSurtido");
const modalDetalle = $("#modalDetalle");
const modalDevolucion = $("#modalDevolucion");
const modalPago = $("#modalPago");
const modalCaja = $("#modalCaja");

let surtidos = [];
let productosNuevo = [];
let surtidoActual = null;
let movimientosCajaActuales = [];
let catalogoProductos = new Map();
let catalogoCargado = false;
let usuarioActual = null;
let perfilActual = null;
let cancelarEscuchaSurtidos = null;
let lectorCodigoMovil = null;
let escanerMovilActivo = false;
let procesandoCodigoMovil = false;
let pedidoEnEdicion = null;
let productosEdicion = [];
let clientesFrecuentes = [];
let cancelarEscuchaClientes = null;
let clientesPreparadosImportacion = [];
let filtroPagadosPendientesActivo = false;
let usuariosSistema = [];
let cancelarEscuchaUsuarios = null;

const ESTADOS = {
  EN_PROCESO: "En proceso",
  CLASIFICADO: "Clasificado",
  ENVIADO: "Enviado",
  CON_REPARTIDOR: "Ingresado a punto de venta",
  ENTREGADO: "Entregado",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
  CON_DEVOLUCION: "Pendiente de registrar devolución"
};

function escapeHtml(valor = "") {
  return String(valor).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[c]);
}

function moneda(valor) {
  return Number(valor || 0).toLocaleString("es-MX", {
    style: "currency", currency: "MXN"
  });
}

function fechaSoloDia(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fechaLocal(valor) {
  if (!valor) return "Sin fecha";
  const fecha = valor.toDate ? valor.toDate() : new Date(valor);
  return fecha.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function fechaPedidoTexto(s) {
  if (s.fechaPedido) {
    const [y, m, d] = s.fechaPedido.split("-");
    return `${d}/${m}/${y}`;
  }
  return fechaLocal(s.creadoEn);
}

function normalizarTexto(valor = "") {
  return String(valor).trim().toLocaleLowerCase("es-MX")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function puedeAgregarClientes() {
  const permiso = perfilActual?.permisos?.agregarClientes;
  if (typeof permiso === "boolean") return permiso;
  return ["admin", "vendedor", "vendor"].includes(perfilActual?.rol);
}

function puedeImportarClientes() {
  const permiso = perfilActual?.permisos?.importarClientes;
  if (typeof permiso === "boolean") return permiso;
  return perfilActual?.rol === "admin";
}

function aplicarPermisoClientes() {
  $("#btnNuevoCliente").classList.toggle("hidden", !puedeAgregarClientes());
  $("#btnCargaClientes").classList.toggle("hidden", !puedeImportarClientes());
}

function claveUnicaCliente(cliente) {
  const nombre = normalizarTexto(cliente.nombre);
  const telefono = String(cliente.telefono || "").replace(/\D/g, "");
  const direccion = normalizarTexto(cliente.direccion);
  return `${nombre}|${telefono || direccion}`;
}

function iniciarEscuchaClientes() {
  if (cancelarEscuchaClientes) cancelarEscuchaClientes();
  cancelarEscuchaClientes = onSnapshot(collection(db, "clientes"), snapshot => {
    clientesFrecuentes = snapshot.docs
      .map(documento => ({ id: documento.id, ...documento.data() }))
      .filter(cliente => cliente.activo !== false)
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
  }, error => {
    console.error("No se pudo cargar el catálogo de clientes:", error);
  });
}

function ocultarResultadosClientes() {
  $("#resultadosClientes").classList.add("hidden");
}

function renderResultadosClientes() {
  const contenedor = $("#resultadosClientes");
  const busqueda = normalizarTexto($("#nombreCliente").value);
  if (!busqueda) {
    ocultarResultadosClientes();
    return;
  }
  const coincidencias = clientesFrecuentes.filter(cliente =>
    normalizarTexto(cliente.nombre).includes(busqueda) ||
    normalizarTexto(cliente.telefono).includes(busqueda)
  ).slice(0, 8);
  contenedor.innerHTML = coincidencias.length
    ? coincidencias.map(cliente => `<button type="button" class="client-result" data-client-id="${escapeHtml(cliente.id)}">
        <strong>${escapeHtml(cliente.nombre || "Cliente sin nombre")}</strong>
        <small>${escapeHtml(cliente.telefono || "Sin teléfono")} · ${escapeHtml(cliente.direccion || "Sin dirección")}</small>
      </button>`).join("")
    : `<p class="client-empty">No se encontró un cliente frecuente.</p>`;
  contenedor.classList.remove("hidden");
}

function seleccionarCliente(cliente) {
  if (!cliente) return;
  $("#clienteId").value = cliente.id || "";
  $("#clienteTelefono").value = cliente.telefono || "";
  $("#nombreCliente").value = cliente.nombre || "";
  const info = $("#clienteSeleccionadoInfo");
  info.textContent = `${cliente.telefono || "Sin teléfono"} · ${cliente.direccion || "Sin dirección"}`;
  info.classList.remove("hidden");

  if ($("#tipoOperacion").value !== "VR") {
    const domicilio = document.querySelector('input[name="tipoEntrega"][value="DOMICILIO"]');
    domicilio.checked = true;
    actualizarCamposEntrega();
    $("#ubicacion").value = cliente.direccion || "";
  }
  ocultarResultadosClientes();
}

function abrirNuevoCliente() {
  if (!puedeAgregarClientes()) return alert("Tu perfil no puede agregar clientes.");
  $("#formNuevoCliente").reset();
  $("#nuevoClienteNombre").value = $("#nombreCliente").value.trim();
  $("#errorNuevoCliente").classList.add("hidden");
  $("#modalNuevoCliente").showModal();
  setTimeout(() => $("#nuevoClienteNombre").focus(), 80);
}

async function guardarNuevoCliente(event) {
  event.preventDefault();
  if (!puedeAgregarClientes()) return;
  const nombre = $("#nuevoClienteNombre").value.trim();
  const telefono = $("#nuevoClienteTelefono").value.trim();
  const direccion = $("#nuevoClienteDireccion").value.trim();
  const nombreNormalizado = normalizarTexto(nombre);
  const error = $("#errorNuevoCliente");
  const duplicado = clientesFrecuentes.find(cliente =>
    claveUnicaCliente(cliente) === claveUnicaCliente({ nombre, telefono, direccion })
  );
  if (duplicado) {
    error.textContent = "Ya existe un cliente con ese nombre. Selecciónalo desde el buscador.";
    error.classList.remove("hidden");
    return;
  }
  const boton = $("#btnGuardarCliente");
  boton.disabled = true;
  boton.textContent = "Guardando…";
  try {
    const referencia = await addDoc(collection(db, "clientes"), {
      nombre, telefono, direccion, nombreNormalizado, activo: true,
      creadoPorUid: usuarioActual?.uid || "",
      creadoPorNombre: perfilActual?.nombre || usuarioActual?.email || "",
      creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp()
    });
    seleccionarCliente({ id: referencia.id, nombre, telefono, direccion });
    $("#modalNuevoCliente").close();
  } catch (e) {
    console.error(e);
    error.textContent = "No se pudo guardar el cliente. Revisa los permisos de Firestore.";
    error.classList.remove("hidden");
  } finally {
    boton.disabled = false;
    boton.textContent = "Guardar cliente";
  }
}

function abrirCargaClientes() {
  if (!puedeImportarClientes()) return alert("Tu perfil no puede importar clientes.");
  clientesPreparadosImportacion = [];
  $("#archivoClientes").value = "";
  $("#resumenCargaClientes").classList.add("hidden");
  $("#vistaPreviaClientes").classList.add("hidden");
  $("#errorCargaClientes").classList.add("hidden");
  $("#btnImportarClientes").disabled = true;
  $("#modalCargaClientes").showModal();
}

function valorColumnaCliente(fila, nombreBuscado) {
  const entrada = Object.entries(fila).find(([encabezado]) => normalizarTexto(encabezado) === nombreBuscado);
  return entrada ? String(entrada[1] ?? "").trim() : "";
}

function mostrarVistaPreviaClientes(filas) {
  const validos = filas.filter(fila => fila.estado === "VALIDO");
  const duplicados = filas.filter(fila => fila.estado === "DUPLICADO");
  const invalidos = filas.filter(fila => fila.estado === "INVALIDO");
  $("#resumenCargaClientes").innerHTML = `
    <article><strong>${validos.length}</strong><small>Listos para importar</small></article>
    <article><strong>${duplicados.length}</strong><small>Duplicados omitidos</small></article>
    <article><strong>${invalidos.length}</strong><small>Filas con error</small></article>`;
  $("#resumenCargaClientes").classList.remove("hidden");
  $("#vistaPreviaClientes").innerHTML = `<table class="client-import-table">
    <thead><tr><th>Fila</th><th>Nombre</th><th>Teléfono</th><th>Dirección</th><th>Resultado</th></tr></thead>
    <tbody>${filas.slice(0, 100).map(fila => `<tr class="${fila.estado === "INVALIDO" ? "invalid" : fila.estado === "DUPLICADO" ? "duplicate" : ""}">
      <td>${fila.numeroFila}</td><td>${escapeHtml(fila.nombre)}</td><td>${escapeHtml(fila.telefono || "—")}</td><td>${escapeHtml(fila.direccion)}</td><td>${escapeHtml(fila.mensaje)}</td>
    </tr>`).join("")}</tbody></table>${filas.length > 100 ? `<p class="client-empty">Se muestran las primeras 100 filas de ${filas.length}.</p>` : ""}`;
  $("#vistaPreviaClientes").classList.remove("hidden");
  clientesPreparadosImportacion = validos;
  $("#btnImportarClientes").disabled = validos.length === 0;
}

async function prepararArchivoClientes(event) {
  const archivo = event.target.files?.[0];
  if (!archivo) return;
  const error = $("#errorCargaClientes");
  error.classList.add("hidden");
  try {
    if (typeof XLSX === "undefined") throw new Error("No se cargó la librería para leer Excel.");
    const datos = await archivo.arrayBuffer();
    const libro = XLSX.read(datos, { type: "array" });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    if (!hoja) throw new Error("El archivo no contiene una hoja válida.");
    const registros = XLSX.utils.sheet_to_json(hoja, { defval: "", raw: false });
    if (!registros.length) throw new Error("El archivo está vacío o no tiene encabezados.");

    const clavesExistentes = new Set(clientesFrecuentes.map(claveUnicaCliente));
    const clavesArchivo = new Set();
    const filas = registros.map((registro, indice) => {
      const nombre = valorColumnaCliente(registro, "nombre");
      const telefono = valorColumnaCliente(registro, "telefono");
      const direccion = valorColumnaCliente(registro, "direccion");
      const fila = { numeroFila: indice + 2, nombre, telefono, direccion, estado: "VALIDO", mensaje: "Listo" };
      if (!nombre || !direccion) {
        fila.estado = "INVALIDO";
        fila.mensaje = !nombre ? "Falta nombre" : "Falta dirección";
        return fila;
      }
      const clave = claveUnicaCliente(fila);
      if (clavesExistentes.has(clave) || clavesArchivo.has(clave)) {
        fila.estado = "DUPLICADO";
        fila.mensaje = "Ya existe";
        return fila;
      }
      clavesArchivo.add(clave);
      return fila;
    });
    mostrarVistaPreviaClientes(filas);
  } catch (e) {
    console.error(e);
    clientesPreparadosImportacion = [];
    $("#btnImportarClientes").disabled = true;
    error.textContent = e.message || "No se pudo leer el archivo.";
    error.classList.remove("hidden");
  }
}

async function importarClientesPreparados() {
  if (!puedeImportarClientes()) return;
  if (!clientesPreparadosImportacion.length) return alert("No hay clientes válidos para importar.");
  const boton = $("#btnImportarClientes");
  boton.disabled = true;
  boton.textContent = "Importando…";
  try {
    const tamanoLote = 400;
    for (let inicio = 0; inicio < clientesPreparadosImportacion.length; inicio += tamanoLote) {
      const lote = clientesPreparadosImportacion.slice(inicio, inicio + tamanoLote);
      const batch = writeBatch(db);
      lote.forEach(cliente => {
        const referencia = doc(collection(db, "clientes"));
        batch.set(referencia, {
          nombre: cliente.nombre,
          telefono: cliente.telefono,
          direccion: cliente.direccion,
          nombreNormalizado: normalizarTexto(cliente.nombre),
          activo: true,
          origen: "IMPORTACION_EXCEL",
          creadoPorUid: usuarioActual?.uid || "",
          creadoPorNombre: perfilActual?.nombre || usuarioActual?.email || "",
          creadoEn: serverTimestamp(),
          actualizadoEn: serverTimestamp()
        });
      });
      await batch.commit();
    }
    const total = clientesPreparadosImportacion.length;
    clientesPreparadosImportacion = [];
    $("#vistaPreviaClientes").innerHTML = `<p class="client-import-result"><strong>${total} clientes importados correctamente.</strong></p>`;
    $("#btnImportarClientes").disabled = true;
    $("#archivoClientes").value = "";
  } catch (e) {
    console.error(e);
    const error = $("#errorCargaClientes");
    error.textContent = "No se pudo completar la importación. Revisa los permisos de Firestore.";
    error.classList.remove("hidden");
    boton.disabled = false;
  } finally {
    boton.textContent = "Importar clientes";
  }
}

function descargarPlantillaClientes() {
  const hoja = XLSX.utils.json_to_sheet([
    { nombre: "Ejemplo Cliente", telefono: "5512345678", direccion: "Calle, número, colonia y municipio" }
  ]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Clientes");
  XLSX.writeFile(libro, "plantilla-clientes.xlsx");
}

function hoyMismo(s) {
  return s.fechaPedido === fechaSoloDia() || (!s.fechaPedido && s.creadoEn &&
    (s.creadoEn.toDate ? s.creadoEn.toDate() : new Date(s.creadoEn)).toDateString() === new Date().toDateString());
}

function textoEstado(estado) {
  return ESTADOS[estado] || estado || "Sin estado";
}

function textoPago(pago) {
  return pago === "PENDIENTE" ? "Pendiente de pago" : pago === "APARTADO" ? "Apartado" : pago === "PAGADO" ? "Pagado" : pago === "K_EFECTIVO" ? "K efectivo" : "Sin definir";
}

function establecerCargaModal(modal, activo, texto = "Guardando cambios…") {
  if (!modal) return;
  let capa = modal.querySelector(".modal-loading-layer");

  if (!capa) {
    capa = document.createElement("div");
    capa.className = "modal-loading-layer hidden";
    capa.innerHTML = `
      <div class="modal-loading-box">
        <span class="loading-spinner" aria-hidden="true"></span>
        <strong class="modal-loading-text"></strong>
      </div>`;
    modal.appendChild(capa);
  }

  capa.querySelector(".modal-loading-text").textContent = texto;
  capa.classList.toggle("hidden", !activo);
  modal.classList.toggle("is-loading", activo);

  for (const control of modal.querySelectorAll("button, input, select, textarea")) {
    if (activo) {
      control.dataset.disabledBeforeLoading = control.disabled ? "1" : "0";
      control.disabled = true;
    } else if (control.dataset.disabledBeforeLoading !== undefined) {
      control.disabled = control.dataset.disabledBeforeLoading === "1";
      delete control.dataset.disabledBeforeLoading;
    }
  }
}

function mostrarResultadoModal(modal, texto) {
  if (!modal) return;
  let aviso = modal.querySelector(".modal-result-message");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.className = "modal-result-message hidden";
    const header = modal.querySelector(".dialog-header");
    if (header) header.insertAdjacentElement("afterend", aviso);
    else modal.prepend(aviso);
  }
  aviso.textContent = texto;
  aviso.classList.remove("hidden");
  clearTimeout(aviso._hideTimer);
  aviso._hideTimer = setTimeout(() => aviso.classList.add("hidden"), 3000);
}

function totalPiezas(productos = []) {
  return productos.reduce((sum, p) => sum + Number(p.cantidad || 0), 0);
}

function totalPedido(productos = []) {
  return productos.reduce((sum, p) => sum + Number(p.cantidad || 0) * Number(p.costo || 0), 0);
}

function porcentajeDescuento(valor) {
  const numero = Number(valor || 0);
  return Number.isInteger(numero) && numero >= 1 && numero <= 99 ? numero : 0;
}

function tipoDescuentoPedido(pedido = {}) {
  if (["TOTAL", "PRODUCTO"].includes(pedido.tipoDescuento)) return pedido.tipoDescuento;
  if (porcentajeDescuento(pedido.descuentoGeneral)) return "TOTAL";
  if ((pedido.productos || []).some(p => porcentajeDescuento(p.descuentoPorcentaje))) return "PRODUCTO";
  return "NINGUNO";
}

function descuentoProductoAplicado(producto, tipo = "NINGUNO", descuentoGeneral = 0) {
  if (tipo === "TOTAL") return porcentajeDescuento(descuentoGeneral);
  if (tipo === "PRODUCTO") return porcentajeDescuento(producto.descuentoPorcentaje);
  return 0;
}

function costoUnitarioConDescuento(producto, tipo = "NINGUNO", descuentoGeneral = 0) {
  const costo = Number(producto.costo || 0);
  const porcentaje = descuentoProductoAplicado(producto, tipo, descuentoGeneral);
  return Math.round(costo * (1 - porcentaje / 100) * 100) / 100;
}

function subtotalProductosConDescuento(productos = [], tipo = "NINGUNO", descuentoGeneral = 0) {
  return productos.reduce((sum, producto) =>
    sum + Number(producto.cantidad || 0) * costoUnitarioConDescuento(producto, tipo, descuentoGeneral), 0);
}

function resumenDescuento(productos = [], tipo = "NINGUNO", descuentoGeneral = 0) {
  const subtotalOriginal = totalPedido(productos);
  const subtotalConDescuento = subtotalProductosConDescuento(productos, tipo, descuentoGeneral);
  return {
    subtotalOriginal,
    subtotalConDescuento,
    montoDescuento: Math.max(0, subtotalOriginal - subtotalConDescuento)
  };
}

function resumenDescuentoPedido(pedido = {}) {
  return resumenDescuento(
    pedido.productos || [],
    tipoDescuentoPedido(pedido),
    Number(pedido.descuentoGeneral || 0)
  );
}


function metodoPagoTexto(metodo) {
  return metodo === "EFECTIVO" ? "Efectivo" :
    metodo === "K_EFECTIVO" ? "K efectivo" :
    metodo === "TRANSFERENCIA" ? "Transferencia" : "No registrado";
}

function pagosPedido(s) {
  if (Array.isArray(s.pagos)) return s.pagos;
  // Compatibilidad con pedidos creados antes de esta versión.
  if (Number(s.montoApartado || 0) > 0) {
    return [{
      id: "pago-anterior",
      monto: Number(s.montoApartado || 0),
      metodo: s.metodoPago || "",
      fecha: s.fechaPago || s.fechaPedido || ""
    }];
  }
  return [];
}

function totalPagado(s) {
  return pagosPedido(s).reduce((sum, pago) => sum + Number(pago.monto || 0), 0);
}


function tieneProductosDisponiblesParaDevolver(s) {
  return (s?.productos || []).some(producto => {
    const yaDevuelto = (s?.devoluciones || []).reduce((total, devolucion) => {
      const encontrado = (devolucion.productos || [])
        .find(item => item.idLinea === producto.idLinea);
      return total + Number(encontrado?.cantidadDevuelta || 0);
    }, 0);

    return Math.max(0, Number(producto.cantidad || 0) - yaDevuelto) > 0;
  });
}

function importeDevoluciones(s) {
  return (s.devoluciones || []).reduce((total, devolucion) => {
    if (Number.isFinite(Number(devolucion.importeAjuste))) {
      return total + Number(devolucion.importeAjuste);
    }
    return total + (devolucion.productos || []).reduce((sum, producto) =>
      sum + Number(producto.cantidadDevuelta || 0) * Number(producto.costoAplicado ?? producto.costo ?? 0), 0);
  }, 0);
}


function devolucionesPendientesRevision(s) {
  return (s?.devoluciones || []).filter(devolucion => {
    const estado = devolucion.estatusRevision || "PENDIENTE_SISTEMA";
    return estado !== "REGISTRADA_SISTEMA";
  });
}

function tieneDevolucionesPendientesRevision(s) {
  return devolucionesPendientesRevision(s).length > 0;
}

function textoEstatusRevision(valor) {
  return valor === "REGISTRADA_SISTEMA"
    ? "Registrada en el sistema"
    : "Pendiente de registrar en el sistema";
}

function totalAjustadoPedido(s) {
  const resumen = resumenDescuentoPedido(s);
  const totalGuardado = s.total !== undefined && s.total !== null
    ? Number(s.total)
    : resumen.subtotalConDescuento + Number(s.costoEnvio || 0);
  return Math.max(0, totalGuardado - importeDevoluciones(s));
}

function saldoPendiente(s) {
  return Math.max(0, totalAjustadoPedido(s) - totalPagado(s));
}

function saldoFavor(s) {
  return Math.max(0, totalPagado(s) - totalAjustadoPedido(s));
}

function estatusPagoCalculado(s) {
  const pagado = totalPagado(s);
  const ajustado = totalAjustadoPedido(s);

  if (ajustado <= 0.009) return "PAGADO";
  if (pagado <= 0) return "PENDIENTE";
  if (pagado >= ajustado) return "PAGADO";
  return "APARTADO";
}

function fechaDesdeTexto(fechaTexto) {
  if (!fechaTexto) return null;
  const partes = String(fechaTexto).split("-").map(Number);
  if (partes.length !== 3 || partes.some(Number.isNaN)) return null;
  return new Date(partes[0], partes[1] - 1, partes[2], 0, 0, 0, 0);
}

function diasDesdeFecha(fechaTexto) {
  const inicio = fechaDesdeTexto(fechaTexto);
  if (!inicio) return 0;
  const hoy = fechaDesdeTexto(fechaSoloDia());
  return Math.floor((hoy - inicio) / 86400000);
}

function apartadoVencido(s) {
  if (s.tipoOperacion === "VR" || s.estado === "FINALIZADO") return false;

  return s.estatusPago === "APARTADO" &&
    saldoPendiente(s) > 0 &&
    diasDesdeFecha(s.fechaPedido) > 15;
}

function textoVencimiento(s) {
  if (s.tipoOperacion === "VR" || s.estado === "FINALIZADO") return "";
  if (s.estatusPago !== "APARTADO" || saldoPendiente(s) <= 0) return "";
  const dias = diasDesdeFecha(s.fechaPedido);
  if (dias > 15) return `Vencido hace ${dias - 15} día(s)`;
  if (dias === 15) return "Vence hoy";
  return `Quedan ${15 - dias} día(s)`;
}

async function cancelarApartadosVencidos() {
  const vencidos = surtidos.filter(s =>
    apartadoVencido(s) &&
    !["CANCELADO", "FINALIZADO"].includes(s.estado) &&
    s.motivoCancelacion !== "APARTADO_VENCIDO"
  );

  for (const s of vencidos) {
    try {
      const dineroAportado = totalPagado(s);

      await updateDoc(doc(db, "surtidos", s.idFirestore), {
        estado: "FINALIZADO",
        cancelado: true,
        motivoCancelacion: "APARTADO_VENCIDO",
        fechaCancelacion: fechaSoloDia(),
        reversoCajaCancelacion: dineroAportado > 0,
        saldoFavorCancelacion: dineroAportado,
        devolucionInventarioPendiente: false,
        productosRegresadosInventario: false,
        canceladoEn: serverTimestamp(),
        finalizadoEn: serverTimestamp(),
        actualizadoEn: serverTimestamp(),
        historial: arrayUnion({
          tipo: "CANCELACION_AUTOMATICA",
          detalle: dineroAportado > 0
            ? `Pedido cancelado y finalizado automáticamente por superar los 15 días. Salida de caja: ${moneda(dineroAportado)}.`
            : "Pedido cancelado y finalizado automáticamente por superar los 15 días. Sin dinero recibido.",
          fechaISO: new Date().toISOString()
        })
      });
    } catch (error) {
      console.error("No se pudo cancelar el apartado vencido:", s.folio, error);
    }
  }
}


function fechaISOValida(fecha) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ""));
}

function inicioSemanaDesdeValor(valorSemana) {
  if (!/^\d{4}-W\d{2}$/.test(valorSemana || "")) return null;
  const [anioTexto, semanaTexto] = valorSemana.split("-W");
  const anio = Number(anioTexto);
  const semana = Number(semanaTexto);
  const cuatroEnero = new Date(anio, 0, 4);
  const dia = cuatroEnero.getDay() || 7;
  const lunesSemanaUno = new Date(anio, 0, 4 - dia + 1);
  const inicio = new Date(lunesSemanaUno);
  inicio.setDate(lunesSemanaUno.getDate() + (semana - 1) * 7);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

function fechaEnRango(fechaTexto, inicio, fin) {
  const fecha = fechaDesdeTexto(fechaTexto);
  return fecha && fecha >= inicio && fecha <= fin;
}

function rangoCajaSeleccionado() {
  const periodo = $("#periodoCaja").value;

  if (periodo === "DIA") {
    const valor = $("#fechaCaja").value;
    const fecha = fechaDesdeTexto(valor);
    if (!fecha) return null;
    const fin = new Date(fecha);
    fin.setHours(23, 59, 59, 999);
    return { inicio: fecha, fin, etiqueta: valor };
  }

  if (periodo === "SEMANA") {
    const valor = $("#semanaCaja").value;
    const inicio = inicioSemanaDesdeValor(valor);
    if (!inicio) return null;
    const fin = new Date(inicio);
    fin.setDate(fin.getDate() + 6);
    fin.setHours(23, 59, 59, 999);
    return { inicio, fin, etiqueta: valor };
  }

  const valor = $("#mesCaja").value;
  if (!/^\d{4}-\d{2}$/.test(valor || "")) return null;
  const [anio, mes] = valor.split("-").map(Number);
  const inicio = new Date(anio, mes - 1, 1);
  const fin = new Date(anio, mes, 0, 23, 59, 59, 999);
  return { inicio, fin, etiqueta: valor };
}

function todosLosMovimientosCaja() {
  const movimientos = [];

  for (const pedido of surtidos) {
    for (const pago of pagosPedido(pedido)) {
      if (!fechaISOValida(pago.fecha)) continue;

      movimientos.push({
        tipo: "INGRESO",
        fecha: pago.fecha,
        folio: pedido.folio || "",
        cliente: pedido.nombreCliente || "",
        metodo: pago.metodo || "",
        importe: Number(pago.monto || 0),
        vendedor: pedido.vendedor || "",
        responsable: pedido.responsable || "",
        ubicacion: pedido.ubicacion || "",
        estadoPedido: textoEstado(pedido.estado),
        estatusPago: textoPago(pedido.estatusPago),
        concepto: "Pago recibido"
      });
    }

    for (const devolucion of pedido.devoluciones || []) {
      const fecha = devolucion.fecha || String(devolucion.fechaISO || "").slice(0, 10);
      if (!fechaISOValida(fecha)) continue;

      movimientos.push({
        tipo: "DEVOLUCION",
        fecha,
        folio: pedido.folio || "",
        cliente: pedido.nombreCliente || "",
        metodo: "DEVOLUCION",
        importe: -Math.abs(Number(devolucion.importeAjuste || 0)),
        vendedor: pedido.vendedor || "",
        responsable: pedido.responsable || "",
        ubicacion: pedido.ubicacion || "",
        estadoPedido: textoEstado(pedido.estado),
        estatusPago: textoPago(pedido.estatusPago),
        concepto: devolucion.motivo || "Devolución"
      });
    }

    const importeCancelacion = Number(
      pedido.saldoFavorCancelacion ??
      (
        pedido.reversoCajaCancelacion
          ? totalPagado(pedido)
          : 0
      )
    );

    if (
      pedido.reversoCajaCancelacion &&
      importeCancelacion > 0 &&
      fechaISOValida(pedido.fechaCancelacion)
    ) {
      movimientos.push({
        tipo: "CANCELACION",
        fecha: pedido.fechaCancelacion,
        folio: pedido.folio || "",
        cliente: pedido.nombreCliente || "",
        metodo: "CANCELACION",
        importe: -Math.abs(importeCancelacion),
        vendedor: pedido.vendedor || "",
        responsable: pedido.responsable || "",
        ubicacion: pedido.ubicacion || "",
        estadoPedido: textoEstado(pedido.estado),
        estatusPago: textoPago(pedido.estatusPago),
        concepto: pedido.motivoCancelacion === "APARTADO_VENCIDO"
          ? "Cancelación por falta de liquidación"
          : "Cancelación de pedido"
      });
    }
  }

  return movimientos.sort((a, b) =>
    b.fecha.localeCompare(a.fecha) || b.folio.localeCompare(a.folio)
  );
}

function actualizarCamposPeriodoCaja() {
  const periodo = $("#periodoCaja").value;
  $("#campoFechaCaja").classList.toggle("hidden", periodo !== "DIA");
  $("#campoSemanaCaja").classList.toggle("hidden", periodo !== "SEMANA");
  $("#campoMesCaja").classList.toggle("hidden", periodo !== "MES");
}

function consultarCaja() {
  const rango = rangoCajaSeleccionado();
  if (!rango) {
    alert("Selecciona un periodo válido.");
    return;
  }

  const metodo = $("#metodoCaja").value;
  movimientosCajaActuales = todosLosMovimientosCaja().filter(movimiento =>
    fechaEnRango(movimiento.fecha, rango.inicio, rango.fin) &&
    (!metodo || movimiento.metodo === metodo)
  );

  const efectivo = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO" && m.metodo === "EFECTIVO")
    .reduce((sum, m) => sum + m.importe, 0);

  const transferencia = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO" && m.metodo === "TRANSFERENCIA")
    .reduce((sum, m) => sum + m.importe, 0);
  const ingresos = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO")
    .reduce((sum, m) => sum + m.importe, 0);

  const devoluciones = Math.abs(
    movimientosCajaActuales
      .filter(m => ["DEVOLUCION", "CANCELACION"].includes(m.tipo))
      .reduce((sum, m) => sum + m.importe, 0)
  );

  const neto = ingresos - devoluciones;

  $("#cajaTotal").textContent = moneda(ingresos);
  $("#cajaDevoluciones").textContent = moneda(devoluciones);
  $("#cajaNeto").textContent = moneda(neto);
  $("#cajaEfectivo").textContent = moneda(efectivo);
  $("#cajaTransferencia").textContent = moneda(transferencia);
  $("#cajaMovimientos").textContent = movimientosCajaActuales.length;

  const tbody = $("#tablaCaja");
  tbody.innerHTML = "";
  $("#sinMovimientosCaja").classList.toggle("hidden", movimientosCajaActuales.length > 0);

  for (const movimiento of movimientosCajaActuales) {
    const fila = document.createElement("tr");
    fila.innerHTML = `
      <td>${escapeHtml(movimiento.fecha)}</td>
      <td>${escapeHtml(movimiento.folio)}</td>
      <td>${escapeHtml(movimiento.cliente)}</td>
      <td><span class="movement-type ${movimiento.tipo.toLowerCase()}">${
        movimiento.tipo === "DEVOLUCION"
          ? "Devolución"
          : movimiento.tipo === "CANCELACION"
            ? "Cancelación"
            : "Ingreso"
      }</span></td>
      <td>${escapeHtml(
        movimiento.tipo === "INGRESO"
          ? metodoPagoTexto(movimiento.metodo)
          : movimiento.concepto
      )}</td>
      <td class="money-cell ${movimiento.tipo !== "INGRESO" ? "return-amount" : ""}">${moneda(movimiento.importe)}</td>
      <td>${escapeHtml(movimiento.vendedor)}</td>
    `;
    tbody.appendChild(fila);
  }
}

function abrirReporteCaja() {
  if (perfilActual?.rol !== "admin") return alert("Solo el administrador puede consultar la caja.");
  const hoy = fechaSoloDia();
  $("#fechaCaja").value = hoy;
  $("#mesCaja").value = hoy.slice(0, 7);

  const fechaHoy = new Date();
  const fechaTemporal = new Date(Date.UTC(
    fechaHoy.getFullYear(),
    fechaHoy.getMonth(),
    fechaHoy.getDate()
  ));
  const numeroDia = fechaTemporal.getUTCDay() || 7;
  fechaTemporal.setUTCDate(fechaTemporal.getUTCDate() + 4 - numeroDia);
  const inicioAnio = new Date(Date.UTC(fechaTemporal.getUTCFullYear(), 0, 1));
  const numeroSemana = Math.ceil((((fechaTemporal - inicioAnio) / 86400000) + 1) / 7);
  $("#semanaCaja").value = `${fechaTemporal.getUTCFullYear()}-W${String(numeroSemana).padStart(2, "0")}`;

  $("#periodoCaja").value = "DIA";
  $("#metodoCaja").value = "";
  actualizarCamposPeriodoCaja();
  consultarCaja();
  modalCaja.showModal();
}

function exportarCaja() {
  if (!movimientosCajaActuales.length) {
    alert("No hay movimientos para exportar.");
    return;
  }

  const filas = movimientosCajaActuales.map(m => ({
    Fecha: m.fecha,
    Folio: m.folio,
    Cliente: m.cliente,
    Tipo: m.tipo === "DEVOLUCION"
      ? "Devolución"
      : m.tipo === "CANCELACION"
        ? "Cancelación"
        : "Ingreso",
    Concepto: m.tipo === "INGRESO" ? metodoPagoTexto(m.metodo) : m.concepto,
    Método: m.tipo === "INGRESO" ? metodoPagoTexto(m.metodo) : "",
    Importe: m.importe,
    Vendedor: m.vendedor,
    Responsable: m.responsable,
    Ubicaciòn: m.ubicacion,
    "Estado del pedido": m.estadoPedido,
    "Estatus de pago": m.estatusPago
  }));

  const efectivo = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO" && m.metodo === "EFECTIVO")
    .reduce((sum, m) => sum + m.importe, 0);
  const transferencia = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO" && m.metodo === "TRANSFERENCIA")
    .reduce((sum, m) => sum + m.importe, 0);
  const ingresos = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO")
    .reduce((sum, m) => sum + m.importe, 0);
  const devoluciones = Math.abs(
    movimientosCajaActuales
      .filter(m => ["DEVOLUCION", "CANCELACION"].includes(m.tipo))
      .reduce((sum, m) => sum + m.importe, 0)
  );
  const neto = ingresos - devoluciones;

  const resumen = [
    { Concepto: "Ingresos", Importe: ingresos },
    { Concepto: "Salidas y ajustes", Importe: devoluciones },
    { Concepto: "Neto de caja", Importe: neto },
    { Concepto: "Efectivo", Importe: efectivo },
    { Concepto: "Transferencia", Importe: transferencia },
    { Concepto: "Número de movimientos", Importe: movimientosCajaActuales.length }
  ];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(resumen), "Resumen");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), "Movimientos");
  XLSX.writeFile(libro, `reporte-caja-${fechaSoloDia()}.xlsx`);
}

function imprimirCaja() {
  if (!movimientosCajaActuales.length) {
    alert("No hay movimientos para imprimir.");
    return;
  }

  const efectivo = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO" && m.metodo === "EFECTIVO")
    .reduce((sum, m) => sum + m.importe, 0);
  const transferencia = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO" && m.metodo === "TRANSFERENCIA")
    .reduce((sum, m) => sum + m.importe, 0);
  const ingresos = movimientosCajaActuales
    .filter(m => m.tipo === "INGRESO")
    .reduce((sum, m) => sum + m.importe, 0);
  const devoluciones = Math.abs(
    movimientosCajaActuales
      .filter(m => ["DEVOLUCION", "CANCELACION"].includes(m.tipo))
      .reduce((sum, m) => sum + m.importe, 0)
  );
  const neto = ingresos - devoluciones;

  const filas = movimientosCajaActuales.map(m => `
    <tr>
      <td>${escapeHtml(m.fecha)}</td>
      <td>${escapeHtml(m.folio)}</td>
      <td>${escapeHtml(m.cliente)}</td>
      <td>${m.tipo === "DEVOLUCION" ? "Devolución" : m.tipo === "CANCELACION" ? "Cancelación" : "Ingreso"}</td>
      <td>${escapeHtml(m.tipo === "INGRESO" ? metodoPagoTexto(m.metodo) : m.concepto)}</td>
      <td style="text-align:right">${moneda(m.importe)}</td>
    </tr>
  `).join("");

  const ventana = window.open("", "_blank", "width=900,height=700");
  if (!ventana) {
    alert("Permite las ventanas emergentes para imprimir.");
    return;
  }

  ventana.document.write(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Reporte de caja</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        h1 { margin-bottom: 4px; }
        .summary { display: flex; gap: 24px; margin: 20px 0; }
        .summary div { border: 1px solid #bbb; padding: 12px; min-width: 150px; }
        .summary small { display:block; color:#555; }
        table { width:100%; border-collapse:collapse; }
        th, td { border:1px solid #bbb; padding:7px; font-size:12px; text-align:left; }
        th { background:#eee; }
        @media print { button { display:none; } }
      </style>
    </head>
    <body>
      <h1>Reporte de caja</h1>
      <p>Generado: ${new Date().toLocaleString("es-MX")}</p>
      <div class="summary">
        <div><small>Ingresos</small><strong>${moneda(ingresos)}</strong></div>
        <div><small>Salidas y ajustes</small><strong>${moneda(devoluciones)}</strong></div>
        <div><small>Neto</small><strong>${moneda(neto)}</strong></div>
        <div><small>Efectivo</small><strong>${moneda(efectivo)}</strong></div>
        <div><small>Transferencia</small><strong>${moneda(transferencia)}</strong></div>
        <div><small>Movimientos</small><strong>${movimientosCajaActuales.length}</strong></div>
      </div>
      <table>
        <thead><tr><th>Fecha</th><th>Folio</th><th>Cliente</th><th>Tipo</th><th>Concepto/Método</th><th>Importe</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <script>
        window.onload = () => setTimeout(() => window.print(), 250);
      </script>
    </body>
    </html>
  `);
  ventana.document.close();
}


function limpiarClaveProducto(valor) {
  // Se conserva como texto para no perder ceros iniciales.
  return String(valor ?? "").trim();
}

function valorCampoProducto(producto, nombres) {
  for (const nombre of nombres) {
    if (producto && producto[nombre] !== undefined && producto[nombre] !== null) {
      const valor = String(producto[nombre]).trim();
      if (valor) return valor;
    }
  }
  return "";
}

function normalizarProductoCatalogo(producto) {
  const clave = limpiarClaveProducto(valorCampoProducto(producto, [
    "clave", "Clave", "CLAVE",
    "sku", "SKU", "Sku",
    "codigo", "Código", "Codigo", "CODIGO",
    "code", "Code"
  ]));

  const nombre = valorCampoProducto(producto, [
    "descripcion", "Descripción", "Descripcion", "DESCRIPCION",
    "nombre", "Nombre", "NOMBRE",
    "producto", "Producto", "PRODUCTO",
    "title", "Title"
  ]);

  const categoria = valorCampoProducto(producto, [
    "categoria", "Categoría", "Categoria", "CATEGORIA"
  ]);

  const ubicacion = valorCampoProducto(producto, [
    "ubicacion", "Ubicación", "Ubicacion", "UBICACION"
  ]);

  const costoTexto = valorCampoProducto(producto, [
    "costo", "Costo", "COSTO",
    "precio", "Precio", "PRECIO"
  ]);

  const costo = Number(String(costoTexto).replace(/[$,\s]/g, ""));

  return {
    clave,
    nombre,
    categoria,
    ubicacion,
    costo: Number.isFinite(costo) && costo > 0 ? costo : null
  };
}

function actualizarEstadoCatalogo(tipo, texto) {
  const elemento = $("#estadoCatalogo");
  if (!elemento) return;
  elemento.className = `catalog-status ${tipo}`;
  elemento.textContent = texto;
}

async function cargarCatalogoProductos() {
  actualizarEstadoCatalogo("loading", "Cargando catálogo…");

  try {
    const respuesta = await fetch("./inventario.json", { cache: "no-store" });

    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status}`);
    }

    const contenido = await respuesta.json();
    const lista = Array.isArray(contenido)
      ? contenido
      : Array.isArray(contenido.productos)
        ? contenido.productos
        : Array.isArray(contenido.inventario)
          ? contenido.inventario
          : [];

    const indice = new Map();

    for (const registro of lista) {
      const producto = normalizarProductoCatalogo(registro);
      if (!producto.clave) continue;

      // Si hay claves duplicadas, conserva el primer registro válido.
      if (!indice.has(producto.clave)) {
        indice.set(producto.clave, producto);
      }
    }

    catalogoProductos = indice;
    catalogoCargado = true;

    if (catalogoProductos.size === 0) {
      actualizarEstadoCatalogo("warning", "Catálogo vacío");
    } else {
      actualizarEstadoCatalogo(
        "success",
        `${catalogoProductos.size.toLocaleString("es-MX")} productos cargados`
      );
    }
  } catch (error) {
    catalogoCargado = false;
    catalogoProductos = new Map();
    actualizarEstadoCatalogo("error", "No se cargó inventario.json");
    console.error("Error al cargar inventario.json:", error);
  }
}

function mostrarMensajeProducto(texto = "", tipo = "") {
  const elemento = $("#mensajeProducto");
  if (!elemento) return;
  elemento.textContent = texto;
  elemento.className = `product-message ${tipo}`.trim();
}

function buscarProductoCatalogo({ enfocarSiguiente = false } = {}) {
  const campoClave = $("#productoClave");
  const clave = limpiarClaveProducto(campoClave.value);
  campoClave.value = clave;

  if (!clave) {
    $("#productoNombre").value = "";
    mostrarMensajeProducto("");
    return null;
  }

  if (!catalogoCargado) {
    mostrarMensajeProducto(
      "El catálogo todavía no está disponible. Puedes escribir el nombre manualmente.",
      "warning"
    );
    return null;
  }

  const producto = catalogoProductos.get(clave);

  if (!producto) {
    $("#productoNombre").value = "";
    mostrarMensajeProducto(
      "La clave no está en el catálogo. Puedes capturar el nombre manualmente.",
      "not-found"
    );
    $("#productoNombre").focus();
    return null;
  }

  $("#productoNombre").value = producto.nombre || "";

  if (producto.costo && !$("#productoCosto").value) {
    $("#productoCosto").value = producto.costo;
  }

  mostrarMensajeProducto(`Producto encontrado: ${producto.nombre}`, "found");

  if (enfocarSiguiente) {
    if (!$("#productoCosto").value) {
      $("#productoCosto").focus();
    } else {
      $("#productoCantidad").focus();
      $("#productoCantidad").select();
    }
  }

  return producto;
}

function manejarLecturaCodigo(event) {
  if (event.key !== "Enter") return;

  event.preventDefault();
  event.stopPropagation();

  const producto = buscarProductoCatalogo({ enfocarSiguiente: true });

  // No agrega automáticamente la fila porque todavía puede faltar costo o cantidad.
  // El lector completa la clave y el nombre; después el usuario confirma con Agregar.
  return producto;
}

// =========================
// Escáner móvil por cámara
// =========================
function actualizarMensajeEscaner(texto = "", tipo = "") {
  const elemento = $("#mensajeEscaner");
  if (!elemento) return;
  elemento.textContent = texto;
  elemento.className = `scanner-message ${tipo}`.trim();
}

function esDispositivoMovil() {
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.matchMedia("(max-width: 1024px)").matches)
  );
}

async function detenerEscanerMovil() {
  escanerMovilActivo = false;

  if (!lectorCodigoMovil) return;

  try {
    if (lectorCodigoMovil.isScanning) {
      await lectorCodigoMovil.stop();
    }
  } catch (error) {
    console.warn("No fue posible detener el escáner:", error);
  }

  try {
    lectorCodigoMovil.clear();
  } catch (error) {
    console.warn("No fue posible limpiar el escáner:", error);
  }

  lectorCodigoMovil = null;
}

async function cerrarEscanerMovil() {
  await detenerEscanerMovil();

  const modal = $("#modalEscaner");
  if (modal?.open) modal.close();
}

async function procesarCodigoMovil(codigoLeido) {
  if (procesandoCodigoMovil) return;

  const clave = limpiarClaveProducto(codigoLeido);
  if (!clave) return;

  procesandoCodigoMovil = true;
  actualizarMensajeEscaner(`Código detectado: ${clave}`, "success");

  if ("vibrate" in navigator) navigator.vibrate(120);

  const campoClave = $("#productoClave");
  if (campoClave) campoClave.value = clave;

  await cerrarEscanerMovil();

  const producto = buscarProductoCatalogo({ enfocarSiguiente: true });
  if (!producto) $("#productoNombre")?.focus();

  window.setTimeout(() => {
    procesandoCodigoMovil = false;
  }, 500);
}

async function iniciarEscanerMovil() {
  const modal = $("#modalEscaner");
  const contenedor = $("#lectorCodigoMovil");

  if (!modal || !contenedor) {
    alert("No se encontró la ventana del escáner en el HTML.");
    return;
  }

  if (!window.Html5Qrcode) {
    alert("No fue posible cargar la librería del escáner. Revisa tu conexión a internet.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Este navegador no permite usar la cámara. Abre el sistema desde HTTPS en Chrome o Safari.");
    return;
  }

  if (escanerMovilActivo) return;

  modal.showModal();
  actualizarMensajeEscaner("Solicitando permiso para usar la cámara…");

  try {
    lectorCodigoMovil = new window.Html5Qrcode("lectorCodigoMovil");
    escanerMovilActivo = true;

    const configuracion = {
      fps: 12,
      qrbox: (anchoVista, altoVista) => ({
        width: Math.min(Math.floor(anchoVista * 0.88), 340),
        height: Math.min(Math.floor(altoVista * 0.36), 150)
      }),
      aspectRatio: 1.5,
      disableFlip: true
    };

    actualizarMensajeEscaner("Apunta la cámara al código de barras.");

    await lectorCodigoMovil.start(
      { facingMode: "environment" },
      configuracion,
      codigo => procesarCodigoMovil(codigo),
      () => {
        // Los intentos sin lectura son normales y no deben mostrarse como error.
      }
    );
  } catch (error) {
    console.error("Error al iniciar el escáner móvil:", error);
    await detenerEscanerMovil();

    let mensaje = "No se pudo abrir la cámara. Revisa los permisos del navegador.";
    const nombreError = error?.name || "";
    const textoError = String(error?.message || error || "").toLowerCase();

    if (nombreError === "NotAllowedError" || textoError.includes("permission")) {
      mensaje = "El permiso de cámara fue rechazado. Actívalo en la configuración del navegador.";
    } else if (nombreError === "NotFoundError" || textoError.includes("camera not found")) {
      mensaje = "No se encontró una cámara disponible en este dispositivo.";
    } else if (!window.isSecureContext) {
      mensaje = "La cámara necesita que el sistema esté publicado con HTTPS.";
    }

    actualizarMensajeEscaner(mensaje, "error");
  }
}

function configurarBotonEscanerMovil() {
  const boton = $("#btnEscanearCodigo");
  if (!boton) return;

  // CSS controla la visualización; esta clase también permite teléfonos con pantalla grande.
  boton.classList.toggle("dispositivo-movil", esDispositivoMovil());
}

function siguienteFolio(tipo) {
  const hoy = fechaSoloDia().replaceAll("-", "");
  const consecutivo = Date.now().toString().slice(-5);
  return `${tipo}-${hoy}-${consecutivo}`;
}

function transicionesPermitidas(estadoActual) {
  const mapa = {
    EN_PROCESO: ["ENVIADO", "CANCELADO"],
    CLASIFICADO: ["ENTREGADO", "FINALIZADO", "CANCELADO"],
    ENVIADO: ["CON_REPARTIDOR", "CANCELADO"],
    CON_REPARTIDOR: ["ENTREGADO", "CANCELADO"],
    ENTREGADO: ["FINALIZADO"],
    CON_DEVOLUCION: ["FINALIZADO"],
    FINALIZADO: [],
    CANCELADO: ["FINALIZADO"]
  };
  return mapa[estadoActual] || ["EN_PROCESO", "CLASIFICADO", "ENVIADO", "CON_REPARTIDOR", "ENTREGADO", "FINALIZADO", "CANCELADO"];
}

function aplicarPermisos() {
  const esAdmin = perfilActual?.rol === "admin";

  document.querySelectorAll("[data-admin-only]").forEach(elemento => {
    elemento.classList.toggle("hidden", !esAdmin);
  });

  $("#usuarioNombre").textContent =
    perfilActual?.nombre || usuarioActual?.email || "Usuario";

  $("#usuarioRol").textContent =
    esAdmin ? "Administrador" : String(perfilActual?.rol || "Usuario").replaceAll("_", " ");
  const tieneFoto = Boolean(perfilActual?.fotoUrl);
  $("#usuarioFoto").classList.toggle("hidden", !tieneFoto);
  $("#usuarioFotoIcono").classList.toggle("hidden", tieneFoto);
  if (tieneFoto) $("#usuarioFoto").src = perfilActual.fotoUrl;
  aplicarPermisoClientes();
}

async function cargarPerfilUsuario(user) {
  const referencia = doc(db, "usuarios", user.uid);
  const snapshot = await getDoc(referencia);

  if (!snapshot.exists()) {
    throw new Error(
      "Tu cuenta existe, pero todavía no tiene un perfil autorizado en Firestore."
    );
  }

  const perfil = snapshot.data();
  if (!perfil.rol || typeof perfil.rol !== "string") {
    throw new Error("Esta cuenta no tiene un rol válido asignado.");
  }

  if (perfil.activo === false) {
    throw new Error("Esta cuenta se encuentra desactivada.");
  }

  return perfil;
}

function textoRolUsuario(rol) {
  return rol === "admin" ? "Administrador" : "Vendedor";
}

function mostrarErrorGestionUsuarios(mensaje = "") {
  const elemento = $("#errorGestionUsuarios");
  elemento.textContent = mensaje;
  elemento.classList.toggle("hidden", !mensaje);
}

function renderUsuariosSistema() {
  const contenedor = $("#listaUsuarios");
  if (!usuariosSistema.length) {
    contenedor.innerHTML = '<div class="empty">No hay cuentas registradas para mostrar.</div>';
    return;
  }

  contenedor.innerHTML = "";
  for (const usuario of usuariosSistema) {
    const fila = document.createElement("div");
    fila.className = "user-row";
    const activo = usuario.activo !== false;
    fila.innerHTML = `
      <span class="user-photo">${usuario.fotoUrl ? `<img src="${escapeHtml(usuario.fotoUrl)}" alt="Foto de ${escapeHtml(usuario.nombre || "usuario")}">` : '<i class="fa-solid fa-user"></i>'}</span>
      <div><strong>${escapeHtml(usuario.nombre || "Sin nombre")}</strong><small>Vendedor automático</small></div>
      <div><strong>${escapeHtml(usuario.correo || "Sin correo")}</strong><small>ID: ${escapeHtml(usuario.idFirestore)}</small></div>
      <span class="user-role">${escapeHtml(textoRolUsuario(usuario.rol))}</span>
      <button type="button" class="${activo ? "danger" : "secondary"}">${activo ? "Desactivar" : "Activar"}</button>`;

    const boton = fila.querySelector("button");
    if (usuario.idFirestore === usuarioActual?.uid) {
      boton.disabled = true;
      boton.title = "No puedes desactivar tu propia cuenta";
    }
    boton.addEventListener("click", async () => {
      if (!confirm(`¿Deseas ${activo ? "desactivar" : "activar"} la cuenta de ${usuario.nombre || usuario.correo}?`)) return;
      boton.disabled = true;
      try {
        await updateDoc(doc(db, "usuarios", usuario.idFirestore), {
          activo: !activo,
          actualizadoEn: serverTimestamp(),
          actualizadoPorUid: usuarioActual?.uid || ""
        });
      } catch (error) {
        console.error(error);
        alert("No se pudo actualizar la cuenta. Revisa los permisos de Firestore.");
        boton.disabled = false;
      }
    });
    contenedor.appendChild(fila);
  }
}

function iniciarEscuchaUsuarios() {
  if (cancelarEscuchaUsuarios) cancelarEscuchaUsuarios();
  cancelarEscuchaUsuarios = onSnapshot(collection(db, "usuarios"), snapshot => {
    usuariosSistema = snapshot.docs
      .map(documento => ({ idFirestore: documento.id, ...documento.data() }))
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    renderUsuariosSistema();
  }, error => {
    console.error(error);
    mostrarErrorGestionUsuarios("No se pudieron consultar las cuentas. Revisa los permisos de Firestore.");
  });
}

function abrirGestionUsuarios() {
  if (perfilActual?.rol !== "admin") return alert("Solo el administrador puede gestionar cuentas.");
  mostrarErrorGestionUsuarios("");
  $("#modalGestionUsuarios").showModal();
}

async function crearUsuarioSistema(event) {
  event.preventDefault();
  if (perfilActual?.rol !== "admin") return;

  const nombre = $("#nuevoUsuarioNombre").value.trim();
  const correo = $("#nuevoUsuarioCorreo").value.trim().toLowerCase();
  const rol = $("#nuevoUsuarioRol").value;
  const contrasena = $("#nuevoUsuarioContrasena").value;
  const foto = $("#nuevoUsuarioFoto").files[0] || null;
  const boton = $("#btnCrearUsuario");
  let cuentaCreada = null;
  let referenciaFoto = null;

  if (foto && !["image/jpeg", "image/png", "image/webp"].includes(foto.type)) {
    return mostrarErrorGestionUsuarios("La imagen debe ser JPG, PNG o WebP.");
  }
  if (foto && foto.size > 2 * 1024 * 1024) {
    return mostrarErrorGestionUsuarios("La imagen de perfil no debe superar 2 MB.");
  }

  mostrarErrorGestionUsuarios("");
  boton.disabled = true;
  boton.textContent = "Creando…";

  try {
    const credencial = await createUserWithEmailAndPassword(authUsuarios, correo, contrasena);
    cuentaCreada = credencial.user;
    let fotoUrl = "";
    if (foto) {
      const extension = foto.type === "image/png" ? "png" : foto.type === "image/webp" ? "webp" : "jpg";
      referenciaFoto = storageRef(storage, `perfiles/${cuentaCreada.uid}/perfil.${extension}`);
      await uploadBytes(referenciaFoto, foto, { contentType: foto.type });
      fotoUrl = await getDownloadURL(referenciaFoto);
    }
    await setDoc(doc(db, "usuarios", cuentaCreada.uid), {
      nombre,
      correo,
      rol,
      fotoUrl,
      activo: true,
      creadoEn: serverTimestamp(),
      creadoPorUid: usuarioActual?.uid || "",
      creadoPorNombre: perfilActual?.nombre || usuarioActual?.email || ""
    });
    $("#formNuevoUsuario").reset();
    $("#nuevoUsuarioRol").value = "vendedor";
    alert("La cuenta se creó correctamente. El nombre se usará como vendedor automático.");
  } catch (error) {
    console.error(error);
    if (cuentaCreada) {
      try { await deleteUser(cuentaCreada); } catch (cleanupError) { console.error(cleanupError); }
    }
    if (referenciaFoto) {
      try { await deleteObject(referenciaFoto); } catch (cleanupError) { console.error(cleanupError); }
    }
    const mensajes = {
      "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
      "auth/invalid-email": "El correo electrónico no es válido.",
      "auth/weak-password": "La contraseña debe contener al menos 6 caracteres.",
      "auth/network-request-failed": "No se pudo conectar con Firebase."
    };
    mostrarErrorGestionUsuarios(mensajes[error.code] || "No se pudo crear la cuenta. Revisa los permisos de Firebase.");
  } finally {
    await signOut(authUsuarios).catch(() => {});
    boton.disabled = false;
    boton.innerHTML = '<i class="fa-solid fa-user-plus"></i> Crear cuenta';
  }
}

function iniciarEscuchaPedidos() {
  if (cancelarEscuchaSurtidos) cancelarEscuchaSurtidos();

  const q = query(collection(db, "surtidos"), orderBy("creadoEn", "desc"));
  cancelarEscuchaSurtidos = onSnapshot(q, snapshot => {
    surtidos = snapshot.docs.map(d => ({ idFirestore: d.id, ...d.data() }));
    renderLista();

    if (perfilActual?.rol === "admin") {
      cancelarApartadosVencidos();
    }
  }, error => {
    $("#estadoConexion").textContent =
      "Error al leer Firestore. Revisa la configuración, el usuario y las reglas.";
    console.error(error);
  });
}

async function cerrarSesion() {
  if (!confirm("¿Deseas cerrar la sesión?")) return;
  await signOut(auth);
}

onAuthStateChanged(auth, async user => {
  usuarioActual = user;

  if (!user) {
    perfilActual = null;
    surtidos = [];
    if (cancelarEscuchaSurtidos) {
      cancelarEscuchaSurtidos();
      cancelarEscuchaSurtidos = null;
    }
    if (cancelarEscuchaClientes) {
      cancelarEscuchaClientes();
      cancelarEscuchaClientes = null;
    }
    if (cancelarEscuchaUsuarios) {
      cancelarEscuchaUsuarios();
      cancelarEscuchaUsuarios = null;
    }
    clientesFrecuentes = [];
    usuariosSistema = [];

    window.location.replace("login.html");
    return;
  }

  try {
    perfilActual = await cargarPerfilUsuario(user);
    aplicarPermisos();

    $("#aplicacion").classList.remove("hidden");
    $("#estadoConexion").textContent =
      `Conectado como ${perfilActual.nombre || user.email}. Los cambios se guardan automáticamente.`;

    iniciarEscuchaPedidos();
    iniciarEscuchaClientes();
    if (perfilActual?.rol === "admin") iniciarEscuchaUsuarios();
  } catch (error) {
    console.error(error);
    sessionStorage.setItem("loginError", error.message || "La cuenta no está autorizada.");
    await signOut(auth);
    window.location.replace("login.html");
  }
});
function pedidoPagadoPendienteEnvio(s) {
  return s.eliminado !== true &&
    s.tipoOperacion !== "VR" &&
    s.estado !== "FINALIZADO" &&
    !["ENVIADO", "CON_REPARTIDOR", "ENTREGADO"].includes(s.estado) &&
    (s.estatusPago === "PAGADO" || saldoPendiente(s) <= 0.009);
}

function prioridadEstadoListado(s) {
  if (s.estado === "FINALIZADO") return 2;
  if (s.estado === "ENTREGADO") return 1;
  return 0;
}

function actualizarAlertaPagadosPendientes() {
  const pendientes = surtidos.filter(pedidoPagadoPendienteEnvio);
  const alerta = $("#alertaPedidosPagados");
  alerta.classList.toggle("hidden", pendientes.length === 0);

  if (!pendientes.length) {
    filtroPagadosPendientesActivo = false;
    return;
  }

  $("#tituloAlertaPagados").textContent = pendientes.length === 1
    ? "1 pedido pagado pendiente de envío"
    : `${pendientes.length} pedidos pagados pendientes de envío`;
  $("#textoAlertaPagados").textContent =
    "Requieren preparación o cambio de estatus antes de enviarse.";
  $("#btnVerPagadosPendientes").textContent =
    filtroPagadosPendientesActivo ? "Mostrar todos" : "Ver pedidos";
  alerta.classList.toggle("is-filtering", filtroPagadosPendientesActivo);
}

function renderLista() {
  const texto = $("#buscador").value.trim().toLowerCase();
  const filtro = $("#filtroEstado").value;
  const filtroPago = $("#filtroPago").value;
  const filtroMetodo = $("#filtroMetodo").value;
  const filtroDevolucion = $("#filtroDevolucion").value;

  let filtrados = surtidos.filter(s => {
    if (s.eliminado === true) return false;
    const contenido = [
      s.folio, s.nombreCliente, s.ubicacion, s.responsable, s.vendedor,
      ...(s.productos || []).flatMap(p => [p.clave, p.nombre])
    ].filter(Boolean).join(" ").toLowerCase();
    const coincidePago = !filtroPago ||
      (filtroPago === "VENCIDO" ? apartadoVencido(s) : s.estatusPago === filtroPago);
    const coincideMetodo = !filtroMetodo ||
      pagosPedido(s).some(pago => pago.metodo === filtroMetodo);
    const tieneDevoluciones = (s.devoluciones || []).length > 0;
    const coincideDevolucion = !filtroDevolucion ||
      (filtroDevolucion === "CON_DEVOLUCION" && tieneDevoluciones) ||
      (filtroDevolucion === "SIN_DEVOLUCION" && !tieneDevoluciones);

    return (!texto || contenido.includes(texto)) &&
      (!filtro || s.estado === filtro) &&
      coincidePago &&
      coincideMetodo &&
      coincideDevolucion;
  });

  if (filtroPagadosPendientesActivo) {
    filtrados = filtrados.filter(pedidoPagadoPendienteEnvio);
  }
  filtrados.sort((a, b) => prioridadEstadoListado(a) - prioridadEstadoListado(b));

  actualizarAlertaPagadosPendientes();
  lista.innerHTML = "";
  $("#sinResultados").classList.toggle("hidden", filtrados.length > 0);

  for (const s of filtrados) {
    const nodo = $("#templateCard").content.cloneNode(true);
    nodo.querySelector(".card-id").textContent = s.folio || "Sin folio";
    const status = nodo.querySelector(".status");
    status.textContent =
      s.estado === "FINALIZADO" && s.cancelado
        ? "Finalizado · Cancelado"
        : textoEstado(s.estado);
    status.classList.add(s.estado || "EN_PROCESO");
    nodo.querySelector(".card-client").textContent = s.nombreCliente || "Cliente no registrado";
    nodo.querySelector(".card-date").textContent = `Fecha: ${fechaPedidoTexto(s)}`;
    const tipoOperacionTexto =
      s.tipoOperacion === "ALM"
        ? "Almacén"
        : s.tipoOperacion === "BAZ"
          ? "Bazar"
          : s.tipoOperacion === "VR"
            ? "Venta rápida"
            : "Pedido";

    nodo.querySelector(".card-location").textContent =
      `${tipoOperacionTexto} · Ubicación: ${s.ubicacion || "Sin Ubicación"}`;
    const vencimiento = textoVencimiento(s);
    nodo.querySelector(".card-payment").innerHTML =
      `Pago: <strong>${escapeHtml(textoPago(s.estatusPago))}</strong> · Total ajustado: ${moneda(totalAjustadoPedido(s))} · Pagado: ${moneda(totalPagado(s))} · Saldo: ${moneda(saldoPendiente(s))}
      ${vencimiento ? `<br><span class="${apartadoVencido(s) ? "overdue-text" : "deadline-text"}">${escapeHtml(vencimiento)}</span>` : ""}`;
    nodo.querySelector(".card-count").textContent =
      `${s.productos?.length || 0} productos · ${totalPiezas(s.productos)} piezas${(s.devoluciones || []).length ? " · Con devolución" : ""}`;

    const tarjeta = nodo.querySelector(".card");
    const pendienteEnvio = pedidoPagadoPendienteEnvio(s);
    nodo.querySelector(".card-shipping-alert").classList.toggle("hidden", !pendienteEnvio);
    tarjeta.classList.toggle("paid-pending-shipment", pendienteEnvio);
    tarjeta.classList.toggle("finalized-order-card", s.estado === "FINALIZADO");
    if (s.estado === "FINALIZADO" && (s.devoluciones || []).length) {
      tarjeta.classList.add("finalized-return-card");
    }

    const botonPagoRapido = nodo.querySelector(".card-quick-pay");
    const puedeAgregarPago =
      saldoPendiente(s) > 0.009 && !["CANCELADO", "FINALIZADO"].includes(s.estado);
    botonPagoRapido.classList.toggle("hidden", !puedeAgregarPago);
    botonPagoRapido.addEventListener("click", event => {
      event.stopPropagation();
      surtidoActual = s;
      abrirPago();
    });

    nodo.querySelector(".card-open").addEventListener("click", () => abrirDetalle(s));

    const esAdmin = perfilActual?.rol === "admin";
    const botonEditar = nodo.querySelector(".card-edit");
    const botonEliminar = nodo.querySelector(".card-delete");
    botonEditar.classList.toggle("hidden", !esAdmin);
    botonEliminar.classList.toggle("hidden", !esAdmin);
    botonEditar.addEventListener("click", event => {
      event.stopPropagation();
      abrirEdicionPedido(s);
    });
    botonEliminar.addEventListener("click", event => {
      event.stopPropagation();
      eliminarPedidoLogico(s);
    });

    lista.appendChild(nodo);
  }

  const pedidosActivos = surtidos.filter(s => s.eliminado !== true);
  $("#totalHoy").textContent = pedidosActivos.filter(hoyMismo).length;
  $("#totalProceso").textContent = pedidosActivos.filter(s => s.estado === "EN_PROCESO").length;
  $("#totalRuta").textContent = pedidosActivos.filter(s => ["CLASIFICADO", "ENVIADO", "CON_REPARTIDOR"].includes(s.estado)).length;
  $("#totalFinalizados").textContent = pedidosActivos.filter(s => ["ENTREGADO", "FINALIZADO"].includes(s.estado)).length;
}


function asegurarAdministrador() {
  if (perfilActual?.rol === "admin") return true;
  alert("Solo el administrador puede realizar esta acción.");
  return false;
}

function snapshotEditablePedido(s) {
  return {
    nombreCliente: s.nombreCliente || "",
    vendedor: s.vendedor || "",
    responsable: s.responsable || "",
    tipoOperacion: s.tipoOperacion || "ALM",
    estado: s.estado || "EN_PROCESO",
    estatusPago: s.estatusPago || "PENDIENTE",
    ubicacion: s.ubicacion || "",
    costoEnvio: Number(s.costoEnvio || 0),
    tipoDescuento: tipoDescuentoPedido(s),
    descuentoGeneral: Number(s.descuentoGeneral || 0),
    productos: (s.productos || []).map(p => ({
      idLinea: p.idLinea || crypto.randomUUID(),
      clave: p.clave || "",
      nombre: p.nombre || "",
      costo: Number(p.costo || 0),
      cantidad: Number(p.cantidad || 1),
      descuentoPorcentaje: Number(p.descuentoPorcentaje || 0)
    }))
  };
}

function renderProductosEdicion() {
  const contenedor = $("#productosEditar");
  contenedor.innerHTML = "";

  productosEdicion.forEach((producto, index) => {
    const modoProducto = $("#editarTipoDescuento").value === "PRODUCTO";
    const fila = document.createElement("div");
    fila.className = "edit-product-row";
    fila.innerHTML = `
      <label>Clave<input class="edit-product-key" value="${escapeHtml(producto.clave)}" maxlength="50"></label>
      <label>Producto<input class="edit-product-name" value="${escapeHtml(producto.nombre)}" maxlength="180" required></label>
      <label>Costo<input class="edit-product-cost" type="number" min="0.01" step="0.01" value="${Number(producto.costo || 0)}" required></label>
      <label>Cantidad<input class="edit-product-qty" type="number" min="1" step="1" value="${Number(producto.cantidad || 1)}" required></label>
      <label class="edit-product-discount ${modoProducto ? "" : "hidden"}">Descuento %<input class="edit-product-discount-input" type="number" min="0" max="99" step="1" value="${Number(producto.descuentoPorcentaje || 0)}"></label>
      <button type="button" class="danger edit-product-remove" title="Quitar producto"><i class="fa-solid fa-trash"></i></button>`;

    const sincronizar = () => {
      producto.clave = fila.querySelector(".edit-product-key").value.trim();
      producto.nombre = fila.querySelector(".edit-product-name").value.trim();
      producto.costo = Number(fila.querySelector(".edit-product-cost").value || 0);
      producto.cantidad = Number(fila.querySelector(".edit-product-qty").value || 0);
      producto.descuentoPorcentaje = Number(fila.querySelector(".edit-product-discount-input").value || 0);
      actualizarTotalEdicion();
    };
    fila.querySelectorAll("input").forEach(input => input.addEventListener("input", sincronizar));
    fila.querySelector(".edit-product-remove").addEventListener("click", () => {
      if (productosEdicion.length === 1) return alert("El pedido debe conservar al menos un producto.");
      productosEdicion.splice(index, 1);
      renderProductosEdicion();
      actualizarTotalEdicion();
    });
    contenedor.appendChild(fila);
  });
}

function actualizarTotalEdicion() {
  const tipo = $("#editarTipoDescuento").value || "NINGUNO";
  const descuentoGeneral = tipo === "TOTAL" ? Number($("#editarDescuentoGeneral").value || 0) : 0;
  const resumen = resumenDescuento(productosEdicion, tipo, descuentoGeneral);
  const envio = Number($("#editarCostoEnvio")?.value || 0);
  $("#editarSubtotalOriginal").textContent = moneda(resumen.subtotalOriginal);
  $("#editarMontoDescuento").textContent = `-${moneda(resumen.montoDescuento)}`;
  $("#editarResumenEnvio").textContent = moneda(Math.max(0, envio));
  $("#totalEditarPedido").textContent = moneda(resumen.subtotalConDescuento + Math.max(0, envio));
}

function actualizarModoDescuentoEdicion() {
  const tipo = $("#editarTipoDescuento").value;
  $("#editarCampoDescuentoGeneral").classList.toggle("hidden", tipo !== "TOTAL");
  if (tipo !== "TOTAL") $("#editarDescuentoGeneral").value = "";
  renderProductosEdicion();
  actualizarTotalEdicion();
}

function abrirEdicionPedido(s) {
  if (!asegurarAdministrador()) return;
  pedidoEnEdicion = s;
  productosEdicion = snapshotEditablePedido(s).productos;

  $("#editarPedidoFolio").textContent = `${s.folio || "Pedido"} · Creado ${fechaPedidoTexto(s)}`;
  $("#editarNombreCliente").value = s.nombreCliente || "";
  $("#editarVendedor").value = s.vendedor || "";
  $("#editarResponsable").value = s.responsable || "";
  $("#editarTipoOperacion").value = s.tipoOperacion || "ALM";
  $("#editarEstado").value = s.estado || "EN_PROCESO";
  $("#editarEstatusPago").value = s.estatusPago || "PENDIENTE";
  $("#editarUbicacion").value = s.ubicacion || "";
  $("#editarCostoEnvio").value = Number(s.costoEnvio || 0);
  $("#editarTipoDescuento").value = tipoDescuentoPedido(s);
  $("#editarDescuentoGeneral").value = porcentajeDescuento(s.descuentoGeneral) || "";
  $("#editarCampoDescuentoGeneral").classList.toggle("hidden", tipoDescuentoPedido(s) !== "TOTAL");
  $("#motivoEdicionPedido").value = "";
  renderProductosEdicion();
  actualizarTotalEdicion();
  $("#modalEditarPedido").showModal();
}

function validarProductosEdicion() {
  if (!productosEdicion.length) return "Agrega al menos un producto.";
  for (const p of productosEdicion) {
    if (!String(p.nombre || "").trim()) return "Todos los productos deben tener nombre.";
    if (!Number.isFinite(Number(p.costo)) || Number(p.costo) <= 0) return "Todos los productos deben tener un costo mayor a cero.";
    if (!Number.isInteger(Number(p.cantidad)) || Number(p.cantidad) < 1) return "Todas las cantidades deben ser números enteros mayores a cero.";
    const descuento = Number(p.descuentoPorcentaje || 0);
    if (!Number.isInteger(descuento) || descuento < 0 || descuento > 99) return "El descuento por producto debe ser un número entero entre 1 y 99, o 0 para no aplicar.";
  }
  if ($("#editarTipoDescuento").value === "TOTAL" && !porcentajeDescuento($("#editarDescuentoGeneral").value)) {
    return "El descuento general debe ser un número entero entre 1 y 99.";
  }
  return "";
}

function generarCambiosPedido(antes, despues) {
  const etiquetas = {
    nombreCliente: "Cliente", vendedor: "Vendedor", responsable: "Responsable",
    tipoOperacion: "Tipo de operación", estado: "Estado", estatusPago: "Estatus de pago",
    ubicacion: "Ubicación", costoEnvio: "Costo de envío",
    tipoDescuento: "Tipo de descuento", descuentoGeneral: "Descuento general"
  };
  const cambios = [];
  for (const campo of Object.keys(etiquetas)) {
    if (String(antes[campo] ?? "") !== String(despues[campo] ?? "")) {
      cambios.push({ campo, etiqueta: etiquetas[campo], anterior: antes[campo] ?? "", nuevo: despues[campo] ?? "" });
    }
  }
  if (JSON.stringify(antes.productos) !== JSON.stringify(despues.productos)) {
    cambios.push({ campo: "productos", etiqueta: "Productos", anterior: `${antes.productos.length} líneas`, nuevo: `${despues.productos.length} líneas` });
  }
  return cambios;
}

async function guardarEdicionPedido(event) {
  event.preventDefault();
  if (!asegurarAdministrador() || !pedidoEnEdicion?.idFirestore) return;

  const errorProductos = validarProductosEdicion();
  if (errorProductos) return alert(errorProductos);
  const motivo = $("#motivoEdicionPedido").value.trim();
  if (!motivo) return alert("Escribe el motivo de la edición.");

  if (["ENTREGADO", "FINALIZADO"].includes(pedidoEnEdicion.estado)) {
    const confirmar = confirm("Este pedido ya está entregado o finalizado. Al guardar quedará registrada su reapertura en el historial. ¿Continuar?");
    if (!confirmar) return;
  }

  const antes = snapshotEditablePedido(pedidoEnEdicion);
  const costoEnvio = Math.max(0, Number($("#editarCostoEnvio").value || 0));
  const despues = {
    nombreCliente: $("#editarNombreCliente").value.trim(),
    vendedor: $("#editarVendedor").value.trim(),
    responsable: $("#editarResponsable").value,
    tipoOperacion: $("#editarTipoOperacion").value,
    estado: $("#editarEstado").value,
    estatusPago: $("#editarEstatusPago").value,
    ubicacion: $("#editarUbicacion").value.trim(),
    costoEnvio,
    tipoDescuento: $("#editarTipoDescuento").value,
    descuentoGeneral: $("#editarTipoDescuento").value === "TOTAL" ? Number($("#editarDescuentoGeneral").value || 0) : 0,
    productos: productosEdicion.map(p => ({ ...p, clave: limpiarClaveProducto(p.clave), nombre: p.nombre.trim(), costo: Number(p.costo), cantidad: Number(p.cantidad), descuentoPorcentaje: $("#editarTipoDescuento").value === "PRODUCTO" ? Number(p.descuentoPorcentaje || 0) : 0 }))
  };
  if (!despues.nombreCliente || !despues.vendedor || !despues.responsable) return alert("Completa cliente, vendedor y responsable.");

  const resumen = resumenDescuento(despues.productos, despues.tipoDescuento, despues.descuentoGeneral);
  const subtotalProductos = resumen.subtotalConDescuento;
  const total = subtotalProductos + costoEnvio;
  const pagadoActual = totalPagado(pedidoEnEdicion);
  despues.estatusPago = pagadoActual >= total - 0.009 ? "PAGADO" : pagadoActual > 0 ? "APARTADO" : "PENDIENTE";
  const cambios = generarCambiosPedido(antes, despues);
  if (!cambios.length) return alert("No se detectaron cambios.");
  const historial = {
    tipo: ["ENTREGADO", "FINALIZADO"].includes(pedidoEnEdicion.estado) ? "PEDIDO_REABIERTO_Y_EDITADO" : "PEDIDO_EDITADO",
    detalle: motivo,
    cambios,
    usuarioUid: usuarioActual?.uid || "",
    usuarioNombre: perfilActual?.nombre || usuarioActual?.email || "Administrador",
    fechaISO: new Date().toISOString()
  };

  try {
    establecerCargaModal($("#modalEditarPedido"), true, "Guardando cambios…");
    await updateDoc(doc(db, "surtidos", pedidoEnEdicion.idFirestore), {
      ...despues,
      subtotalProductosOriginal: resumen.subtotalOriginal,
      subtotalProductos,
      descuentoTotal: resumen.montoDescuento,
      total,
      actualizadoEn: serverTimestamp(),
      actualizadoPorUid: usuarioActual?.uid || "",
      actualizadoPorNombre: perfilActual?.nombre || usuarioActual?.email || "",
      historial: arrayUnion(historial)
    });
    $("#modalEditarPedido").close();
    if (modalDetalle.open) modalDetalle.close();
  } catch (error) {
    console.error(error);
    alert("No se pudo actualizar el pedido. Revisa las reglas de Firestore.");
  } finally {
    establecerCargaModal($("#modalEditarPedido"), false);
  }
}

async function eliminarPedidoLogico(s) {
  if (!asegurarAdministrador() || !s?.idFirestore) return;
  const motivo = prompt(`Vas a eliminar el pedido ${s.folio || "sin folio"}.\n\nEscribe el motivo de la eliminación:`);
  if (motivo === null) return;
  if (!motivo.trim()) return alert("El motivo de eliminación es obligatorio.");
  if (!confirm(`¿Confirmas eliminar ${s.folio || "este pedido"}?\n\nEl pedido se ocultará, pero conservará su historial para auditoría.`)) return;

  try {
    await updateDoc(doc(db, "surtidos", s.idFirestore), {
      eliminado: true,
      eliminadoEn: serverTimestamp(),
      eliminadoFechaISO: new Date().toISOString(),
      eliminadoPorUid: usuarioActual?.uid || "",
      eliminadoPorNombre: perfilActual?.nombre || usuarioActual?.email || "Administrador",
      motivoEliminacion: motivo.trim(),
      actualizadoEn: serverTimestamp(),
      historial: arrayUnion({
        tipo: "PEDIDO_ELIMINADO",
        detalle: motivo.trim(),
        usuarioUid: usuarioActual?.uid || "",
        usuarioNombre: perfilActual?.nombre || usuarioActual?.email || "Administrador",
        fechaISO: new Date().toISOString()
      })
    });
    if (surtidoActual?.idFirestore === s.idFirestore && modalDetalle.open) modalDetalle.close();
  } catch (error) {
    console.error(error);
    alert("No se pudo eliminar el pedido. Revisa las reglas de Firestore.");
  }
}

function costoEnvioNuevo() {
  const tipoEntrega =
    document.querySelector('input[name="tipoEntrega"]:checked')?.value || "";

  if (tipoEntrega !== "DOMICILIO") return 0;

  const costo = Number($("#costoEnvio").value || 0);
  return Number.isFinite(costo) && costo > 0 ? costo : 0;
}

function totalNuevoPedido() {
  const tipo = $("#tipoDescuento").value || "NINGUNO";
  const descuentoGeneral = tipo === "TOTAL" ? Number($("#descuentoGeneral").value || 0) : 0;
  return subtotalProductosConDescuento(productosNuevo, tipo, descuentoGeneral) + costoEnvioNuevo();
}

function actualizarTotalNuevo() {
  const tipo = $("#tipoDescuento").value || "NINGUNO";
  const descuentoGeneral = tipo === "TOTAL" ? Number($("#descuentoGeneral").value || 0) : 0;
  const resumen = resumenDescuento(productosNuevo, tipo, descuentoGeneral);
  const envio = costoEnvioNuevo();
  $("#subtotalOriginalNuevo").textContent = moneda(resumen.subtotalOriginal);
  $("#descuentoNuevo").textContent = `-${moneda(resumen.montoDescuento)}`;
  $("#envioNuevo").textContent = moneda(envio);
  $("#totalNuevo").textContent = moneda(resumen.subtotalConDescuento + envio);
}

function actualizarModoDescuentoNuevo() {
  const tipo = $("#tipoDescuento").value;
  $("#campoDescuentoGeneral").classList.toggle("hidden", tipo !== "TOTAL");
  $("#campoDescuentoProducto").classList.toggle("hidden", tipo !== "PRODUCTO");
  if (tipo !== "TOTAL") $("#descuentoGeneral").value = "";
  if (tipo !== "PRODUCTO") $("#productoDescuento").value = "";
  renderProductosNuevo();
  actualizarTotalNuevo();
}

function renderProductosNuevo() {
  const cont = $("#productosNuevo");
  cont.innerHTML = "";
  productosNuevo.forEach((p, index) => {
    const tipo = $("#tipoDescuento").value || "NINGUNO";
    const general = tipo === "TOTAL" ? Number($("#descuentoGeneral").value || 0) : 0;
    const descuento = descuentoProductoAplicado(p, tipo, general);
    const costoNeto = costoUnitarioConDescuento(p, tipo, general);
    const row = document.createElement("div");
    row.className = `product-row ${tipo === "PRODUCTO" ? "with-discount-input" : ""}`;
    row.innerHTML = `
      <div><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.clave || "Sin clave")}</small></div>
      <span>${descuento ? `<span class="price-original">${moneda(p.costo)}</span><br>${moneda(costoNeto)} c/u<br><small class="discount-badge">-${descuento}%</small>` : `${moneda(p.costo)} c/u`}</span>
      <span>${p.cantidad} pza.</span>
      ${tipo === "PRODUCTO" ? `<label class="inline-product-discount">Descuento %<input type="number" min="0" max="99" step="1" value="${Number(p.descuentoPorcentaje || 0)}"></label>` : ""}
      <button type="button" class="danger">Quitar</button>`;
    row.querySelector(".inline-product-discount input")?.addEventListener("input", event => {
      p.descuentoPorcentaje = Number(event.target.value || 0);
      actualizarTotalNuevo();
    });
    row.querySelector("button").addEventListener("click", () => {
      productosNuevo.splice(index, 1);
      renderProductosNuevo();
      actualizarTotalNuevo();
    });
    cont.appendChild(row);
  });
}

function agregarProducto() {
  const clave = limpiarClaveProducto($("#productoClave").value);
  $("#productoClave").value = clave;

  if (clave && !$("#productoNombre").value.trim()) {
    buscarProductoCatalogo();
  }

  const nombre = $("#productoNombre").value.trim();
  const costo = Number($("#productoCosto").value);
  const cantidad = Number($("#productoCantidad").value);
  const descuento = Number($("#productoDescuento").value || 0);

  if (!nombre) return alert("Escribe el nombre del producto.");
  if (!Number.isFinite(costo) || costo <= 0) return alert("El costo debe ser mayor a cero.");
  if (!Number.isInteger(cantidad) || cantidad < 1) return alert("La cantidad debe ser un número entero mayor a cero.");
  if (!Number.isInteger(descuento) || descuento < 0 || descuento > 99) return alert("El descuento debe ser un número entero entre 1 y 99, o 0 para no aplicar.");

  const claveNormalizada = limpiarClaveProducto(clave);
  const nombreNormalizado = nombre.trim().toLowerCase();

  const productoExistente = productosNuevo.find(producto => {
    const mismaClave =
      claveNormalizada &&
      limpiarClaveProducto(producto.clave) === claveNormalizada;

    const mismoProductoSinClave =
      !claveNormalizada &&
      !limpiarClaveProducto(producto.clave) &&
      String(producto.nombre || "").trim().toLowerCase() === nombreNormalizado &&
      Number(producto.costo || 0) === costo;

    return mismaClave || mismoProductoSinClave;
  });

  if (productoExistente) {
    productoExistente.cantidad =
      Number(productoExistente.cantidad || 0) + cantidad;
    if ($("#tipoDescuento").value === "PRODUCTO") productoExistente.descuentoPorcentaje = descuento;

    // The first registered name and price are preserved.
    // Only the quantity is accumulated when the same product is scanned again.
  } else {
    productosNuevo.push({
      idLinea: crypto.randomUUID(),
      clave,
      nombre,
      costo,
      cantidad,
      descuentoPorcentaje: $("#tipoDescuento").value === "PRODUCTO" ? descuento : 0
    });
  }

  $("#productoClave").value = "";
  $("#productoNombre").value = "";
  $("#productoCosto").value = "";
  $("#productoCantidad").value = "1";
  $("#productoDescuento").value = "";
  $("#productoClave").focus();
  renderProductosNuevo();
  actualizarTotalNuevo();
}

function validarPedido() {
  const tipoOperacion = $("#tipoOperacion").value;
  const esVentaRapida = tipoOperacion === "VR";
  const tipoEntrega = document.querySelector('input[name="tipoEntrega"]:checked')?.value;
  const tipoDescuento = $("#tipoDescuento").value;

  if (tipoDescuento === "TOTAL" && !porcentajeDescuento($("#descuentoGeneral").value)) {
    alert("El descuento general debe ser un número entero entre 1 y 99.");
    $("#descuentoGeneral").focus();
    return false;
  }
  if (tipoDescuento === "PRODUCTO" && productosNuevo.some(p => {
    const valor = Number(p.descuentoPorcentaje || 0);
    return !Number.isInteger(valor) || valor < 0 || valor > 99;
  })) {
    alert("Los descuentos por producto deben ser números enteros entre 1 y 99, o 0 para no aplicar.");
    return false;
  }

  if (!esVentaRapida) {
    if (!tipoEntrega) {
      alert("Selecciona si la entrega es en punto de entrega o domicilio.");
      return false;
    }
    if (tipoEntrega === "PUNTO_ENTREGA" && !$("#puntoEntrega").value) {
      alert("Selecciona el punto de entrega.");
      $("#puntoEntrega").focus();
      return false;
    }
    if (tipoEntrega === "DOMICILIO" && !$("#ubicacion").value.trim()) {
      alert("Escribe el domicilio de entrega.");
      $("#ubicacion").focus();
      return false;
    }

    if (tipoEntrega === "DOMICILIO") {
      const costoEnvio = Number($("#costoEnvio").value);
      if (!Number.isFinite(costoEnvio) || costoEnvio < 0) {
        alert("Escribe un costo de envío válido.");
        $("#costoEnvio").focus();
        return false;
      }
    }
  }

  const campos = [
    ["tipoOperacion", "Selecciona el tipo de operación."],
    ["nombreCliente", "Escribe el nombre del cliente."],
    ["responsable", "Selecciona al responsable."],
    ["vendedor", "Escribe el nombre del vendedor."],
    ["estatusPago", "Selecciona el estatus de pago."]
  ];
  for (const [id, mensaje] of campos) {
    if (!$("#" + id).value.trim()) {
      alert(mensaje);
      $("#" + id).focus();
      return false;
    }
  }
  if ($("#estatusPago").value !== "PENDIENTE" && !$("#metodoPagoInicial").value.trim()) {
    alert("Selecciona el método del primer pago.");
    $("#metodoPagoInicial").focus();
    return false;
  }
  if (!productosNuevo.length) {
    alert("Agrega por lo menos un producto.");
    return false;
  }
  const total = totalNuevoPedido();
  if (["APARTADO", "K_EFECTIVO"].includes($("#estatusPago").value)) {
    const montoInicial = Number($("#montoApartado").value);
    if (!Number.isFinite(montoInicial) || montoInicial <= 0) {
      alert("Escribe una cantidad válida para el primer pago.");
      return false;
    }
    if (montoInicial > total) {
      alert("El primer pago no puede ser mayor al total del pedido.");
      return false;
    }
  }
  return true;
}

async function guardarPedido(imprimir) {
  if (!validarPedido()) return;

  const tipoOperacion = $("#tipoOperacion").value;
  const estatusPago = $("#estatusPago").value;
  const estado = tipoOperacion === "VR" ? "FINALIZADO" : $("#estadoInicial").value;
  const costoEnvio = tipoOperacion === "VR" ? 0 : costoEnvioNuevo();
  const tipoDescuento = $("#tipoDescuento").value || "NINGUNO";
  const descuentoGeneral = tipoDescuento === "TOTAL" ? Number($("#descuentoGeneral").value || 0) : 0;
  const productosGuardados = productosNuevo.map(producto => ({
    ...producto,
    descuentoPorcentaje: tipoDescuento === "PRODUCTO" ? Number(producto.descuentoPorcentaje || 0) : 0
  }));
  const resumen = resumenDescuento(productosGuardados, tipoDescuento, descuentoGeneral);
  const totalProductos = resumen.subtotalConDescuento;
  const total = totalProductos + costoEnvio;
  const tienePagoInicial = estatusPago !== "PENDIENTE";
  const montoInicial = ["APARTADO", "K_EFECTIVO"].includes(estatusPago)
    ? Number($("#montoApartado").value)
    : estatusPago === "PAGADO" ? total : 0;
  const metodoInicial = $("#metodoPagoInicial").value;
  const pagoInicial = tienePagoInicial ? {
    id: crypto.randomUUID(),
    monto: montoInicial,
    metodo: metodoInicial,
    fecha: $("#fechaPagoInicial").value,
    fechaISO: new Date().toISOString()
  } : null;

  const registro = {
    folio: siguienteFolio(tipoOperacion),
    fechaPedido: $("#fechaPedido").value,
    tipoOperacion,
    nombreCliente: $("#nombreCliente").value.trim(),
    clienteId: $("#clienteId").value || "",
    clienteTelefono: $("#clienteTelefono").value || "",
    tipoEntrega: tipoOperacion === "VR"
      ? "VENTA_RAPIDA"
      : document.querySelector('input[name="tipoEntrega"]:checked').value,
    puntoEntrega: tipoOperacion === "VR" ? "" : $("#puntoEntrega").value,
    ubicacion: tipoOperacion === "VR"
      ? "Venta rápida"
      : document.querySelector('input[name="tipoEntrega"]:checked').value === "PUNTO_ENTREGA"
        ? $("#puntoEntrega").value
        : $("#ubicacion").value.trim(),
    responsable: $("#responsable").value,
    vendedor: $("#vendedor").value.trim(),
    estatusPago,
    montoApartado: montoInicial,
    metodoPago: metodoInicial,
    fechaPago: pagoInicial?.fecha || "",
    pagos: pagoInicial ? [pagoInicial] : [],
    productos: productosGuardados,
    tipoDescuento,
    descuentoGeneral,
    subtotalProductosOriginal: resumen.subtotalOriginal,
    subtotalProductos: totalProductos,
    descuentoTotal: resumen.montoDescuento,
    costoEnvio,
    total,
    estado,
    creadoPorUid: usuarioActual?.uid || "",
    creadoPorNombre: perfilActual?.nombre || usuarioActual?.email || "",
    creadoPorRol: perfilActual?.rol || "",
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
    devoluciones: [],
    historial: [{
      tipo: "PEDIDO_CREADO",
      detalle: `Pedido creado con estatus ${textoEstado(estado)}`,
      fechaISO: new Date().toISOString()
    }]
  };

  try {
    await addDoc(collection(db, "surtidos"), registro);
    modalSurtido.close();
    $("#formSurtido").reset();
    productosNuevo = [];
    renderProductosNuevo();
    actualizarTotalNuevo();
    if (imprimir) imprimirEtiqueta({ ...registro, creadoEn: new Date() });
  } catch (error) {
    alert("No se pudo guardar el pedido.");
    console.error(error);
  }
}

function abrirDetalle(s) {
  surtidoActual = s;
  $("#detalleId").textContent = s.folio || "Pedido";
  $("#detalleFecha").textContent = fechaPedidoTexto(s);

  const tipoDescuento = tipoDescuentoPedido(s);
  const resumenPedido = resumenDescuentoPedido(s);
  const productosHtml = (s.productos || []).map(p => {
    const descuento = descuentoProductoAplicado(p, tipoDescuento, Number(s.descuentoGeneral || 0));
    const costoNeto = costoUnitarioConDescuento(p, tipoDescuento, Number(s.descuentoGeneral || 0));
    return `
    <div class="product-row">
      <div><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.clave || "Sin clave")}</small></div>
      <span>${descuento ? `<span class="price-original">${moneda(p.costo || 0)}</span><br>${moneda(costoNeto)} c/u<br><small class="discount-badge">-${descuento}%</small>` : `${moneda(p.costo || 0)} c/u`}</span>
      <span>${p.cantidad} pza.</span>
      <strong>${moneda(Number(p.cantidad || 0) * costoNeto)}</strong>
    </div>`;
  }).join("");

  const devolucionesHtml = (s.devoluciones || []).map(d => `
    <div class="history-item">
      <strong>Devolución: ${escapeHtml(d.motivo)} · -${moneda(d.importeAjuste || 0)}</strong><br>
      <small>${escapeHtml(d.fechaLocal)} · Revisión: ${escapeHtml(textoEstatusRevision(d.estatusRevision))} · ${escapeHtml(d.observaciones || "Sin observaciones")}</small>
    </div>`).join("");

  $("#detalleContenido").innerHTML = `
    <div class="detail-meta">
      <div><small>Cliente</small><strong>${escapeHtml(s.nombreCliente || "No registrado")}</strong></div>
      <div><small>Tipo de entrega</small><strong>${
        s.tipoEntrega === "PUNTO_ENTREGA"
          ? "Punto de entrega"
          : s.tipoEntrega === "DOMICILIO"
            ? "Domicilio"
            : s.tipoEntrega === "VENTA_RAPIDA"
              ? "Venta rápida"
              : "No registrado"
      }</strong></div>
      <div><small>Ubicación</small><strong>${escapeHtml(s.ubicacion || "No registrada")}</strong></div>
      <div><small>Tipo de operación</small><strong>${
        s.tipoOperacion === "ALM"
          ? "Almacén"
          : s.tipoOperacion === "BAZ"
            ? "Bazar"
            : s.tipoOperacion === "VR"
              ? "Venta rápida"
              : "Anterior"
      }</strong></div>
      <div><small>Estado</small><strong>${
        s.estado === "FINALIZADO" && s.cancelado
          ? "Finalizado · Cancelado"
          : textoEstado(s.estado)
      }</strong></div>
      <div><small>Pago</small><strong>${textoPago(s.estatusPago)}</strong></div>
      <div><small>Subtotal original</small><strong>${moneda(resumenPedido.subtotalOriginal)}</strong></div>
      <div><small>Tipo de descuento</small><strong>${tipoDescuento === "TOTAL" ? `General ${porcentajeDescuento(s.descuentoGeneral)}%` : tipoDescuento === "PRODUCTO" ? "Por producto" : "Sin descuento"}</strong></div>
      <div><small>Descuento aplicado</small><strong>-${moneda(resumenPedido.montoDescuento)}</strong></div>
      <div><small>Subtotal con descuento</small><strong>${moneda(resumenPedido.subtotalConDescuento)}</strong></div>
      <div><small>Costo de envío</small><strong>${moneda(Number(s.costoEnvio || 0))}</strong></div>
      <div><small>Total del pedido</small><strong>${moneda(resumenPedido.subtotalConDescuento + Number(s.costoEnvio || 0))}</strong></div>
      <div><small>Ajustes por devolución</small><strong class="return-amount">-${moneda(importeDevoluciones(s))}</strong></div>
      <div><small>Total ajustado</small><strong>${moneda(totalAjustadoPedido(s))}</strong></div>
      <div><small>Total pagado</small><strong>${moneda(totalPagado(s))}</strong></div>
      <div><small>Saldo pendiente</small><strong>${moneda(saldoPendiente(s))}</strong></div>
      <div><small>Saldo a favor</small><strong>${moneda(saldoFavor(s))}</strong></div>
      ${s.motivoCancelacion === "APARTADO_VENCIDO" ? `
        <div class="span-detail cancellation-credit">
          <small>Cancelación por falta de liquidación</small>
          <strong>Saldo positivo a favor del cliente: ${moneda(Number(s.saldoFavorCancelacion ?? totalPagado(s)))}</strong>
          <p>Regresa todos los productos de este pedido al inventario y confirma la acción para finalizar.</p>
        </div>` : ""}
      <div><small>Vigencia del apartado</small><strong class="${apartadoVencido(s) ? "overdue-text" : ""}">${escapeHtml(textoVencimiento(s) || "No aplica")}</strong></div>
      <div><small>Responsable</small><strong>${escapeHtml(s.responsable || "No registrado")}</strong></div>
      <div><small>Vendedor</small><strong>${escapeHtml(s.vendedor || "No registrado")}</strong></div>
      <div><small>Piezas</small><strong>${totalPiezas(s.productos)}</strong></div>
    </div>
    <h3>Historial de pagos</h3>
    <div class="payment-history">
      ${pagosPedido(s).length ? pagosPedido(s).map((pago, indice) => `
        <div class="payment-item">
          <div><strong>Pago ${indice + 1}</strong><small>${escapeHtml(pago.fecha || "Sin fecha")}</small></div>
          <div>${escapeHtml(metodoPagoTexto(pago.metodo))}</div>
          <strong>${moneda(pago.monto)}</strong>
        </div>`).join("") : "<p>No hay pagos registrados.</p>"}
    </div>
    <h3>Productos</h3>
    <div class="product-list">${productosHtml}</div>
    ${(s.devoluciones || []).length ? `<div class="history"><h3 class="return-flag">Devoluciones</h3>${devolucionesHtml}</div>` : ""}
  `;

  const panelActualizarEstado = $("#panelActualizarEstado");
  panelActualizarEstado.classList.toggle("hidden", s.estado === "FINALIZADO");

  const selector = $("#cambiarEstado");
  selector.innerHTML = "";
  const permitidos = transicionesPermitidas(s.estado);
  if (!permitidos.length) {
    selector.innerHTML = `<option value="">Sin cambios disponibles</option>`;
    $("#btnCambiarEstado").disabled = true;
  } else {
    for (const estado of permitidos) {
      selector.insertAdjacentHTML("beforeend", `<option value="${estado}">${textoEstado(estado)}</option>`);
    }
    $("#btnCambiarEstado").disabled = false;
  }

  const devolucionPermitidaFinalizado =
    s.estado === "FINALIZADO" &&
    !s.cancelado &&
    ["ALM", "BAZ", "VR"].includes(s.tipoOperacion);

  const ocultarRegistroDevolucion =
    ["EN_PROCESO", "CANCELADO"].includes(s.estado) ||
    (s.estado === "FINALIZADO" && !devolucionPermitidaFinalizado) ||
    !tieneProductosDisponiblesParaDevolver(s);

  $("#btnAbrirDevolucion").classList.toggle("hidden", ocultarRegistroDevolucion);
  $("#btnAgregarPago").classList.toggle("hidden",
    s.estatusPago === "PAGADO" || saldoPendiente(s) <= 0 || ["CANCELADO", "FINALIZADO"].includes(s.estado)
  );

  const cancelacionVencidaPendiente =
    s.motivoCancelacion === "APARTADO_VENCIDO" &&
    s.devolucionInventarioPendiente !== false &&
    !s.productosRegresadosInventario;

  const requiereRevisionInventario =
    tieneDevolucionesPendientesRevision(s) || cancelacionVencidaPendiente;

  const cajaInventario = $("#confirmacionInventarioBox");
  const checkInventario = $("#confirmarSumaInventario");

  if (cancelacionVencidaPendiente) {
    $("#tituloConfirmacionInventario").textContent = "Productos regresados al inventario";
    $("#textoConfirmacionInventario").textContent =
      "Confirma que todos los productos del pedido cancelado ya fueron regresados al inventario.";
  } else {
    $("#tituloConfirmacionInventario").textContent = "Devolución registrada en el sistema";
    $("#textoConfirmacionInventario").textContent =
      "Confirma que la devolución ya fue registrada en el sistema antes de finalizar el pedido.";
  }

  cajaInventario.classList.toggle("hidden", !requiereRevisionInventario);
  checkInventario.checked = false;

  if (!modalDetalle.open) modalDetalle.showModal();
}


function actualizarConfirmacionInventarioPorEstado() {
  if (!surtidoActual) return;
  const caja = $("#confirmacionInventarioBox");
  const nuevoEstado = $("#cambiarEstado").value;
  const requiere =
    tieneDevolucionesPendientesRevision(surtidoActual) ||
    (
      surtidoActual.motivoCancelacion === "APARTADO_VENCIDO" &&
      surtidoActual.devolucionInventarioPendiente !== false &&
      !surtidoActual.productosRegresadosInventario
    );

  caja.classList.toggle("hidden", !requiere);
  caja.classList.toggle("required-now", requiere && nuevoEstado === "FINALIZADO");
}

async function cambiarEstado() {
  if (!surtidoActual) return;
  const nuevoEstado = $("#cambiarEstado").value;
  if (!nuevoEstado) return;

  const cancelacionPorVencimiento =
    surtidoActual.motivoCancelacion === "APARTADO_VENCIDO";

  if (
    nuevoEstado === "FINALIZADO" &&
    saldoPendiente(surtidoActual) > 0.009 &&
    !cancelacionPorVencimiento
  ) {
    alert(
      `No puedes finalizar la venta porque todavía existe un saldo pendiente de ${moneda(saldoPendiente(surtidoActual))}. ` +
      "Registra los pagos necesarios hasta liquidar el total ajustado del pedido."
    );
    return;
  }

  const requiereConfirmacionInventario =
    nuevoEstado === "FINALIZADO" && (
      tieneDevolucionesPendientesRevision(surtidoActual) ||
      (
        surtidoActual.motivoCancelacion === "APARTADO_VENCIDO" &&
        surtidoActual.devolucionInventarioPendiente !== false &&
        !surtidoActual.productosRegresadosInventario
      )
    );

  if (requiereConfirmacionInventario && !$("#confirmarSumaInventario").checked) {
    alert(
      surtidoActual.motivoCancelacion === "APARTADO_VENCIDO"
        ? "Antes de finalizar debes confirmar que los productos ya fueron regresados al inventario."
        : "Antes de finalizar debes confirmar que la devolución ya fue registrada en el sistema."
    );
    $("#confirmarSumaInventario").focus();
    return;
  }

  const devolucionesActualizadas = requiereConfirmacionInventario
    ? (surtidoActual.devoluciones || []).map(devolucion => ({
        ...devolucion,
        estatusRevision: "REGISTRADA_SISTEMA",
        registradoSistema: true,
        registradoSistemaFecha: fechaSoloDia(),
        registradoSistemaFechaISO: new Date().toISOString()
      }))
    : (surtidoActual.devoluciones || []);

  const esCancelacion = nuevoEstado === "CANCELADO";
  const dineroAportadoCancelacion =
    esCancelacion ? totalPagado(surtidoActual) : 0;
  const estadoGuardado = esCancelacion ? "FINALIZADO" : nuevoEstado;

  const mensaje = nuevoEstado === "CANCELADO"
    ? dineroAportadoCancelacion > 0
      ? `¿Seguro que deseas cancelar este pedido? Se registrará una salida de caja por ${moneda(dineroAportadoCancelacion)}.`
      : "¿Seguro que deseas cancelar este pedido?"
    : `¿Cambiar el pedido a "${textoEstado(nuevoEstado)}"?`;

  if (!confirm(mensaje)) return;

  establecerCargaModal(modalDetalle, true, "Actualizando estatus…");

  try {
    await updateDoc(doc(db, "surtidos", surtidoActual.idFirestore), {
      estado: estadoGuardado,
      cancelado: esCancelacion ? true : surtidoActual.cancelado || false,
      motivoCancelacion:
        esCancelacion
          ? (surtidoActual.motivoCancelacion || "CANCELACION_MANUAL")
          : surtidoActual.motivoCancelacion || "",
      fechaCancelacion:
        esCancelacion
          ? fechaSoloDia()
          : surtidoActual.fechaCancelacion || "",
      reversoCajaCancelacion:
        esCancelacion
          ? dineroAportadoCancelacion > 0
          : surtidoActual.reversoCajaCancelacion || false,
      saldoFavorCancelacion:
        esCancelacion
          ? dineroAportadoCancelacion
          : Number(surtidoActual.saldoFavorCancelacion || 0),
      productosRegresadosInventario:
        nuevoEstado === "FINALIZADO" && cancelacionPorVencimiento
          ? true
          : surtidoActual.productosRegresadosInventario || false,
      devolucionInventarioPendiente:
        nuevoEstado === "FINALIZADO" && cancelacionPorVencimiento
          ? false
          : surtidoActual.devolucionInventarioPendiente ?? false,
      actualizadoEn: serverTimestamp(),
      finalizadoEn:
        estadoGuardado === "FINALIZADO"
          ? serverTimestamp()
          : surtidoActual.finalizadoEn || null,
      historial: arrayUnion({
        tipo: "CAMBIO_ESTADO",
        detalle: esCancelacion
          ? dineroAportadoCancelacion > 0
            ? `Pedido cancelado y finalizado. Salida de caja: ${moneda(dineroAportadoCancelacion)}.`
            : "Pedido cancelado y finalizado. Sin dinero recibido."
          : `Estado cambiado de ${textoEstado(surtidoActual.estado)} a ${textoEstado(nuevoEstado)}`,
        fechaISO: new Date().toISOString()
      })
    });

    surtidoActual = {
      ...surtidoActual,
      estado: estadoGuardado,
      devoluciones: devolucionesActualizadas,
      cancelado: esCancelacion ? true : surtidoActual.cancelado || false,
      motivoCancelacion:
        esCancelacion
          ? (surtidoActual.motivoCancelacion || "CANCELACION_MANUAL")
          : surtidoActual.motivoCancelacion || "",
      fechaCancelacion:
        esCancelacion
          ? fechaSoloDia()
          : surtidoActual.fechaCancelacion || "",
      reversoCajaCancelacion:
        esCancelacion
          ? dineroAportadoCancelacion > 0
          : surtidoActual.reversoCajaCancelacion || false,
      saldoFavorCancelacion:
        esCancelacion
          ? dineroAportadoCancelacion
          : Number(surtidoActual.saldoFavorCancelacion || 0),
      productosRegresadosInventario:
        nuevoEstado === "FINALIZADO" && cancelacionPorVencimiento
          ? true
          : surtidoActual.productosRegresadosInventario || false,
      devolucionInventarioPendiente:
        nuevoEstado === "FINALIZADO" && cancelacionPorVencimiento
          ? false
          : surtidoActual.devolucionInventarioPendiente ?? false,
      finalizadoEn:
        estadoGuardado === "FINALIZADO"
          ? new Date()
          : surtidoActual.finalizadoEn
    };
    if (esCancelacion) {
      modalDetalle.close();
      renderLista();
    } else {
      abrirDetalle(surtidoActual);
      mostrarResultadoModal(modalDetalle, `Estatus actualizado: ${textoEstado(nuevoEstado)}.`);
    }
  } catch (error) {
    alert("No se pudo actualizar el estado.");
    console.error(error);
  } finally {
    establecerCargaModal(modalDetalle, false);
  }
}


function abrirPago() {
  if (!surtidoActual) return;
  const saldo = saldoPendiente(surtidoActual);
  if (saldo <= 0) {
    alert("Este pedido ya está pagado.");
    return;
  }
  $("#formPago").reset();
  $("#pagoFolio").textContent = surtidoActual.folio || "";
  $("#nuevaFechaPago").value = fechaSoloDia();
  actualizarResumenModalPago(surtidoActual);
  modalDetalle.close();
  modalPago.showModal();
}

function actualizarResumenModalPago(pedido) {
  const saldo = saldoPendiente(pedido);
  $("#nuevoMontoPago").max = String(saldo);
  $("#resumenPago").innerHTML = `
    <div><small>Total ajustado</small><strong>${moneda(totalAjustadoPedido(pedido))}</strong></div>
    <div><small>Total pagado</small><strong>${moneda(totalPagado(pedido))}</strong></div>
    <div><small>Saldo pendiente</small><strong>${moneda(saldo)}</strong></div>
  `;
}

async function guardarNuevoPago(event) {
  event.preventDefault();
  if (!surtidoActual) return;

  const monto = Number($("#nuevoMontoPago").value);
  const metodo = $("#nuevoMetodoPago").value;
  const saldo = saldoPendiente(surtidoActual);

  if (!Number.isFinite(monto) || monto <= 0) {
    alert("Escribe una cantidad válida.");
    return;
  }
  if (monto > saldo) {
    alert(`El pago no puede superar el saldo pendiente de ${moneda(saldo)}.`);
    return;
  }
  if (!metodo) {
    alert("Selecciona el método de pago.");
    return;
  }
  const pago = {
    id: crypto.randomUUID(),
    monto,
    metodo,
    fecha: fechaSoloDia(),
    fechaISO: new Date().toISOString()
  };
  const nuevoTotalPagado = totalPagado(surtidoActual) + monto;
  const total = totalAjustadoPedido(surtidoActual);
  const nuevoEstatusPago = nuevoTotalPagado >= total
    ? "PAGADO"
    : surtidoActual.estatusPago === "K_EFECTIVO" ? "K_EFECTIVO" : "APARTADO";

  establecerCargaModal(modalPago, true, "Registrando pago…");

  try {
    await updateDoc(doc(db, "surtidos", surtidoActual.idFirestore), {
      pagos: arrayUnion(pago),
      estatusPago: nuevoEstatusPago,
      montoApartado: nuevoTotalPagado,
      metodoPago: metodo,
      fechaPago: pago.fecha,
      actualizadoEn: serverTimestamp(),
      historial: arrayUnion({
        tipo: "PAGO_AGREGADO",
        detalle: `${moneda(monto)} por ${metodoPagoTexto(metodo)}. Estatus: ${textoPago(nuevoEstatusPago)}`,
        fechaISO: new Date().toISOString()
      })
    });

    surtidoActual = {
      ...surtidoActual,
      pagos: [...pagosPedido(surtidoActual), pago],
      estatusPago: nuevoEstatusPago,
      montoApartado: nuevoTotalPagado,
      metodoPago: metodo,
      fechaPago: pago.fecha
    };

    $("#formPago").reset();
    modalPago.close();
    renderLista();
  } catch (error) {
    alert("No se pudo guardar el pago.");
    console.error(error);
  } finally {
    establecerCargaModal(modalPago, false);
  }
}

function abrirDevolucion() {
  if (!surtidoActual) return;
  $("#devolucionId").textContent = surtidoActual.folio;
  const cont = $("#productosDevolucion");
  cont.innerHTML = "";

  for (const p of surtidoActual.productos || []) {
    const yaDevuelto = (surtidoActual.devoluciones || []).reduce((sum, devolucion) => {
      const encontrado = (devolucion.productos || []).find(item => item.idLinea === p.idLinea);
      return sum + Number(encontrado?.cantidadDevuelta || 0);
    }, 0);
    const disponible = Math.max(0, Number(p.cantidad || 0) - yaDevuelto);
    if (disponible <= 0) continue;
    const row = document.createElement("label");
    row.className = "return-row";
    row.innerHTML = `
      <input type="checkbox" data-id="${p.idLinea}">
      <span><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.clave || "Sin clave")}</small></span>
      <input type="number" min="1" max="${disponible}" value="1" disabled>
      <small class="return-available">Disponible para devolución: ${disponible}</small>`;
    const check = row.querySelector('input[type="checkbox"]');
    const qty = row.querySelector('input[type="number"]');
    check.addEventListener("change", () => qty.disabled = !check.checked);
    cont.appendChild(row);
  }

  modalDevolucion.showModal();
}

async function guardarDevolucion(event) {
  event.preventDefault();
  if (!surtidoActual) return;

  const seleccionados = [...$("#productosDevolucion").querySelectorAll(".return-row")]
    .filter(row => row.querySelector('input[type="checkbox"]').checked)
    .map(row => {
      const id = row.querySelector('input[type="checkbox"]').dataset.id;
      const original = surtidoActual.productos.find(p => p.idLinea === id);
      const costoAplicado = costoUnitarioConDescuento(
        original,
        tipoDescuentoPedido(surtidoActual),
        Number(surtidoActual.descuentoGeneral || 0)
      );
      return {
        ...original,
        costoOriginal: Number(original.costo || 0),
        costoAplicado,
        cantidadDevuelta: Number(row.querySelector('input[type="number"]').value)
      };
    });

  if (!seleccionados.length) return alert("Selecciona por lo menos un producto.");

  const motivo = $("#motivoDevolucion").value;
  if (!motivo) return alert("Selecciona el motivo de devolución.");

  const importeAjuste = seleccionados.reduce((sum, producto) =>
    sum + Number(producto.cantidadDevuelta || 0) * Number(producto.costoAplicado ?? producto.costo ?? 0), 0);

  const devolucion = {
    id: crypto.randomUUID(),
    productos: seleccionados,
    motivo,
    observaciones: $("#observacionesDevolucion").value.trim(),
    importeAjuste,
    estatusRevision: "PENDIENTE_SISTEMA",
    registradoSistema: false,
    sumadoInventario: false,
    reincorporadoSicar: false,
    estatusSicar: "PENDIENTE",
    fecha: fechaSoloDia(),
    fechaISO: new Date().toISOString(),
    fechaLocal: new Date().toLocaleString("es-MX")
  };

  const pedidoSimulado = {
    ...surtidoActual,
    devoluciones: [...(surtidoActual.devoluciones || []), devolucion]
  };
  const nuevoEstatusPago = estatusPagoCalculado(pedidoSimulado);

  establecerCargaModal(modalDevolucion, true, "Guardando devolución…");

  try {
    await updateDoc(doc(db, "surtidos", surtidoActual.idFirestore), {
      devoluciones: arrayUnion(devolucion),
      estado: "CON_DEVOLUCION",
      estatusPago: nuevoEstatusPago,
      actualizadoEn: serverTimestamp(),
      historial: arrayUnion({
        tipo: "DEVOLUCION",
        detalle: `${seleccionados.length} producto(s): ${motivo}. Ajuste: -${moneda(importeAjuste)}. Pendiente de registrar en el sistema.`,
        fechaISO: new Date().toISOString()
      })
    });

    surtidoActual = {
      ...surtidoActual,
      devoluciones: [...(surtidoActual.devoluciones || []), devolucion],
      estado: "CON_DEVOLUCION",
      estatusPago: nuevoEstatusPago
    };

    $("#formDevolucion").reset();
    modalDevolucion.close();
    abrirDetalle(surtidoActual);
    renderLista();
  } catch (error) {
    alert("No se pudo guardar la devolución.");
    console.error(error);
  } finally {
    establecerCargaModal(modalDevolucion, false);
  }
}

function imprimirEtiqueta(s) {
  if (!s) {
    alert("No se encontró la información del pedido para imprimir.");
    return;
  }

  const anterior = document.querySelector("#printArea");
  if (anterior) anterior.remove();

  const productos = Array.isArray(s.productos) ? s.productos : [];
  const tipoTexto =
    s.tipoOperacion === "ALM"
      ? "ALMACÉN"
      : s.tipoOperacion === "BAZ"
        ? "BAZAR"
        : s.tipoOperacion === "VR"
          ? "VENTA RÁPIDA"
          : "PEDIDO";
  const cliente = s.nombreCliente || "Cliente no registrado";
  const ubicacionTexto = s.ubicacion || "Sin Ubicación";
  const resumen = resumenDescuentoPedido(s);

  const printArea = document.createElement("section");
  printArea.id = "printArea";
  printArea.innerHTML = `
    <div class="print-header">
    <p><img src="/logo.JPG" alt="Noventia" style="width: 200px"/></p>
      <strong class="print-type">${escapeHtml(tipoTexto)}</strong>
      <h1>${escapeHtml(s.folio || "SIN FOLIO")}</h1>
    </div>
    <div class="print-data">
      <p><strong>Fecha:</strong> ${escapeHtml(fechaPedidoTexto(s))}</p>
      <p><strong>Cliente:</strong> ${escapeHtml(cliente)}</p>
      <p><strong>Vendedor:</strong> ${escapeHtml(s.vendedor || "No registrado")}</p>
      <p><strong>Pago:</strong> ${escapeHtml(textoPago(s.estatusPago))}</p>
      <p><strong>Subtotal original:</strong> ${escapeHtml(moneda(resumen.subtotalOriginal))}</p>
      <p><strong>Descuento:</strong> -${escapeHtml(moneda(resumen.montoDescuento))}</p>
      <p><strong>Subtotal de productos:</strong> ${escapeHtml(moneda(resumen.subtotalConDescuento))}</p>
      <p><strong>Costo de envío:</strong> ${escapeHtml(moneda(Number(s.costoEnvio || 0)))}</p>
      <p><strong>Total del pedido:</strong> ${escapeHtml(moneda(resumen.subtotalConDescuento + Number(s.costoEnvio || 0)))}</p>
      <p><strong>Devoluciones:</strong> -${escapeHtml(moneda(importeDevoluciones(s)))}</p>
      <p><strong>Total ajustado:</strong> ${escapeHtml(moneda(totalAjustadoPedido(s)))}</p>
      <p><strong>Pagado:</strong> ${escapeHtml(moneda(totalPagado(s)))}</p>
      <p><strong>Saldo:</strong> ${escapeHtml(moneda(saldoPendiente(s)))}</p>
      <p><strong>Método(s):</strong> ${escapeHtml([...new Set(pagosPedido(s).map(p => metodoPagoTexto(p.metodo)))].join(", ") || "No registrado")}</p>
      <p><strong>Ubicación:</strong> ${escapeHtml(ubicacionTexto)}</p>
    </div>
    <div class="print-products">
      <strong>Productos:</strong>
      ${productos.length
        ? productos.map(p => `<p>${Number(p.cantidad || 0)} × ${escapeHtml(p.nombre || "Producto sin nombre")}</p>`).join("")
        : "<p>Sin productos registrados</p>"}
    </div>
  `;

  document.body.appendChild(printArea);
  document.body.classList.add("printing-label");

  const limpiarImpresion = () => {
    document.body.classList.remove("printing-label");
    printArea.remove();
    window.removeEventListener("afterprint", limpiarImpresion);
  };

  window.addEventListener("afterprint", limpiarImpresion);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}

function exportarPedidos() {
  if (perfilActual?.rol !== "admin") return alert("Solo el administrador puede exportar pedidos.");
  if (!surtidos.length) return alert("No hay pedidos para exportar.");
  if (typeof XLSX === "undefined") return alert("No se pudo cargar el generador de Excel.");

  const filasPedidos = surtidos.map(s => ({
    Folio: s.folio || "",
    Fecha: fechaPedidoTexto(s),
    "Tipo de operación": s.tipoOperacion === "ALM"
      ? "Almacén"
      : s.tipoOperacion === "BAZ"
        ? "Bazar"
        : s.tipoOperacion === "VR"
          ? "Venta rápida"
          : "",
    Cliente: s.nombreCliente || "",
    "Tipo de entrega": s.tipoEntrega === "PUNTO_ENTREGA" ? "Punto de entrega" : s.tipoEntrega === "DOMICILIO" ? "Domicilio" : "",
    Ubicación: s.ubicacion || "",
    Responsable: s.responsable || "",
    Vendedor: s.vendedor || "",
    Estado: textoEstado(s.estado),
    "Estatus de pago": textoPago(s.estatusPago),
    "Subtotal original de productos": resumenDescuentoPedido(s).subtotalOriginal,
    "Tipo de descuento": tipoDescuentoPedido(s),
    "Descuento general %": tipoDescuentoPedido(s) === "TOTAL" ? porcentajeDescuento(s.descuentoGeneral) : 0,
    "Descuento total": resumenDescuentoPedido(s).montoDescuento,
    "Subtotal de productos": resumenDescuentoPedido(s).subtotalConDescuento,
    "Costo de envío": Number(s.costoEnvio || 0),
    "Total del pedido": resumenDescuentoPedido(s).subtotalConDescuento + Number(s.costoEnvio || 0),
    "Ajustes por devolución": importeDevoluciones(s),
    "Total ajustado": totalAjustadoPedido(s),
    "Total pagado": totalPagado(s),
    "Saldo pendiente": saldoPendiente(s),
    "Saldo a favor": saldoFavor(s),
    "Saldo positivo por cancelación": Number(s.saldoFavorCancelacion || 0),
    "Productos regresados al inventario": s.productosRegresadosInventario ? "Sí" : "No",
    "Métodos de pago": [...new Set(pagosPedido(s).map(p => metodoPagoTexto(p.metodo)))].join(", "),
    "Vencimiento apartado": textoVencimiento(s),
    Total: resumenDescuentoPedido(s).subtotalConDescuento + Number(s.costoEnvio || 0),
    "Productos distintos": s.productos?.length || 0,
    "Piezas totales": totalPiezas(s.productos),
    "Número de devoluciones": s.devoluciones?.length || 0
  }));

  const filasProductos = [];
  for (const s of surtidos) {
    for (const p of s.productos || []) {
      const descuento = descuentoProductoAplicado(p, tipoDescuentoPedido(s), Number(s.descuentoGeneral || 0));
      const costoNeto = costoUnitarioConDescuento(p, tipoDescuentoPedido(s), Number(s.descuentoGeneral || 0));
      filasProductos.push({
        Folio: s.folio || "",
        Fecha: fechaPedidoTexto(s),
        Cliente: s.nombreCliente || "",
        Clave: p.clave || "",
        Producto: p.nombre || "",
        "Costo unitario original": Number(p.costo || 0),
        "Descuento %": descuento,
        "Costo unitario con descuento": costoNeto,
        Cantidad: Number(p.cantidad || 0),
        Subtotal: costoNeto * Number(p.cantidad || 0)
      });
    }
  }

  const filasDevoluciones = [];
  for (const s of surtidos) {
    for (const d of s.devoluciones || []) {
      for (const p of d.productos || []) {
        filasDevoluciones.push({
          Folio: s.folio || "",
          Cliente: s.nombreCliente || "",
          "Fecha devolución": d.fechaLocal || d.fechaISO || "",
          Motivo: d.motivo || "",
          Observaciones: d.observaciones || "",
          Clave: p.clave || "",
          Producto: p.nombre || "",
          "Cantidad devuelta": Number(p.cantidadDevuelta || 0),
          "Importe ajuste": Number(p.cantidadDevuelta || 0) * Number(p.costoAplicado ?? p.costo ?? 0),
          "Estatus de devolución": textoEstatusRevision(d.estatusRevision),
          "Registrada en el sistema": d.registradoSistema ? "Sí" : "No"
        });
      }
    }
  }

  const filasPagos = [];
  for (const s of surtidos) {
    for (const pago of pagosPedido(s)) {
      filasPagos.push({
        Folio: s.folio || "",
        Cliente: s.nombreCliente || "",
        Fecha: pago.fecha || "",
        Método: metodoPagoTexto(pago.metodo),
        Importe: Number(pago.monto || 0),
        "Estatus actual": textoPago(s.estatusPago),
        "Saldo actual": saldoPendiente(s)
      });
    }
  }

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasPedidos), "Pedidos");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasProductos), "Productos");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasPagos.length ? filasPagos : [{ Folio: "" }]), "Pagos");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasDevoluciones.length ? filasDevoluciones : [{ Folio: "" }]), "Devoluciones");
  XLSX.writeFile(libro, `pedidos-${fechaSoloDia()}.xlsx`);
}

document.addEventListener("click", e => {
  const id = e.target.dataset.close;
  if (id) document.getElementById(id).close();
});

function actualizarCamposEntrega() {
  const tipo = document.querySelector('input[name="tipoEntrega"]:checked')?.value || "";
  const esPunto = tipo === "PUNTO_ENTREGA";
  const esDomicilio = tipo === "DOMICILIO";

  $("#campoPuntoEntrega").classList.toggle("hidden", !esPunto);
  $("#campoDomicilio").classList.toggle("hidden", !esDomicilio);
  $("#campoCostoEnvio").classList.toggle("hidden", !esDomicilio);
  $("#puntoEntrega").required = esPunto;
  $("#ubicacion").required = esDomicilio;
  $("#costoEnvio").required = esDomicilio;

  if (!esPunto) $("#puntoEntrega").value = "";
  if (!esDomicilio) {
    $("#ubicacion").value = "";
    $("#costoEnvio").value = "0";
  }

  actualizarTotalNuevo();
}

document.querySelectorAll('input[name="tipoEntrega"]').forEach(control =>
  control.addEventListener("change", actualizarCamposEntrega)
);

$("#costoEnvio").addEventListener("input", actualizarTotalNuevo);

function actualizarCamposPagoInicial() {
  const valor = $("#estatusPago").value;
  const apartado = valor === "APARTADO";
  const esKEfectivo = valor === "K_EFECTIVO";
  const hayPago = valor === "APARTADO" || valor === "PAGADO" || esKEfectivo;

  $("#campoMontoApartado").classList.toggle("hidden", !(apartado || esKEfectivo));
  $("#etiquetaMontoInicial").textContent = esKEfectivo
    ? "Cantidad pagada en K efectivo"
    : "Cantidad del primer apartado";
  $("#campoMetodoPago").classList.toggle("hidden", !hayPago);
  $("#campoFechaPago").classList.toggle("hidden", !hayPago);
  $("#montoApartado").required = apartado || esKEfectivo;
  $("#metodoPagoInicial").required = hayPago;
  $("#metodoPagoInicial").disabled = false;
  $("#fechaPagoInicial").value = hayPago ? fechaSoloDia() : "";

  if (!(apartado || esKEfectivo)) $("#montoApartado").value = "";
}

$("#estatusPago").addEventListener("change", actualizarCamposPagoInicial);
$("#estatusPago").addEventListener("input", actualizarCamposPagoInicial);

function configurarEstadosIniciales(tipoOperacion) {
  const selector = $("#estadoInicial");
  selector.innerHTML = "";

  const opciones = tipoOperacion === "BAZ"
    ? [
        ["CLASIFICADO", "Clasificado"],
        ["ENTREGADO", "Entregado"],
        ["FINALIZADO", "Finalizado"]
      ]
    : [
        ["EN_PROCESO", "En proceso"],
        ["ENVIADO", "Enviado"]
      ];

  for (const [valor, texto] of opciones) {
    const opcion = document.createElement("option");
    opcion.value = valor;
    opcion.textContent = texto;
    selector.appendChild(opcion);
  }
}

function abrirNuevoPedido(tipoOperacion) {
  $("#formSurtido").reset();
  $("#vendedor").value = perfilActual?.nombre || usuarioActual?.email || "";
  $("#vendedor").readOnly = true;
  $("#tipoDescuento").value = "NINGUNO";
  $("#descuentoGeneral").value = "";
  $("#productoDescuento").value = "";
  $("#campoDescuentoGeneral").classList.add("hidden");
  $("#campoDescuentoProducto").classList.add("hidden");
  $("#clienteId").value = "";
  $("#clienteTelefono").value = "";
  $("#clienteSeleccionadoInfo").classList.add("hidden");
  ocultarResultadosClientes();
  $("#tipoOperacion").value = tipoOperacion;
  $("#fechaPedido").value = fechaSoloDia();

  const esVentaRapida = tipoOperacion === "VR";
  $("#modalSurtidoTitulo").textContent =
    tipoOperacion === "ALM"
      ? "Nuevo pedido de almacén"
      : tipoOperacion === "BAZ"
        ? "Nuevo pedido de bazar"
        : "Nueva venta rápida";

  configurarEstadosIniciales(tipoOperacion);

  $("#bloqueTipoEntrega").classList.toggle("hidden", esVentaRapida);
  $("#campoPuntoEntrega").classList.add("hidden");
  $("#campoDomicilio").classList.add("hidden");
  $("#campoCostoEnvio").classList.add("hidden");
  $("#costoEnvio").value = "0";
  $("#costoEnvio").required = false;
  $("#campoEstadoInicial").classList.toggle("hidden", esVentaRapida);

  $("#estadoInicial").required = !esVentaRapida;
  $("#puntoEntrega").required = false;
  $("#ubicacion").required = false;

  productosNuevo = [];
  renderProductosNuevo();
  actualizarTotalNuevo();

  $("#campoMontoApartado").classList.add("hidden");
  $("#campoMetodoPago").classList.add("hidden");
  $("#metodoPagoInicial").required = false;
  $("#metodoPagoInicial").disabled = false;
  $("#etiquetaMontoInicial").textContent = "Cantidad del primer apartado";
  $("#campoFechaPago").classList.add("hidden");
  $("#fechaPagoInicial").value = fechaSoloDia();
  actualizarCamposPagoInicial();
  mostrarMensajeProducto("");

  modalSurtido.showModal();
  setTimeout(() => $("#productoClave").focus(), 100);
}

$("#btnAlmacen").addEventListener("click", () => abrirNuevoPedido("ALM"));
$("#btnBazar").addEventListener("click", () => abrirNuevoPedido("BAZ"));
$("#btnVentaRapida").addEventListener("click", () => abrirNuevoPedido("VR"));

$("#btnReporteCaja").addEventListener("click", abrirReporteCaja);
$("#btnExportar").addEventListener("click", exportarPedidos);
$("#periodoCaja").addEventListener("change", () => {
  actualizarCamposPeriodoCaja();
  consultarCaja();
});
$("#metodoCaja").addEventListener("change", consultarCaja);
$("#btnAplicarCaja").addEventListener("click", consultarCaja);
$("#btnExportarCaja").addEventListener("click", exportarCaja);
$("#btnImprimirCaja").addEventListener("click", imprimirCaja);
$("#btnAgregarProducto").addEventListener("click", agregarProducto);
$("#productoClave").addEventListener("keydown", manejarLecturaCodigo);

const btnEscanearCodigo = $("#btnEscanearCodigo");
const btnCerrarEscaner = $("#btnCerrarEscaner");
const btnCancelarEscaner = $("#btnCancelarEscaner");
const modalEscaner = $("#modalEscaner");

btnEscanearCodigo?.addEventListener("click", iniciarEscanerMovil);
btnCerrarEscaner?.addEventListener("click", cerrarEscanerMovil);
btnCancelarEscaner?.addEventListener("click", cerrarEscanerMovil);
modalEscaner?.addEventListener("cancel", event => {
  event.preventDefault();
  cerrarEscanerMovil();
});
modalEscaner?.addEventListener("close", () => {
  if (escanerMovilActivo) detenerEscanerMovil();
});
$("#productoClave").addEventListener("change", () => buscarProductoCatalogo());
$("#productoClave").addEventListener("blur", () => {
  if ($("#productoClave").value.trim() && !$("#productoNombre").value.trim()) {
    buscarProductoCatalogo();
  }
});
$("#productoClave").addEventListener("input", () => {
  mostrarMensajeProducto("");
});
$("#btnGuardarBorrador").addEventListener("click", () => guardarPedido(false));
$("#btnFinalizarNuevo").addEventListener("click", () => guardarPedido(true));
$("#cambiarEstado").addEventListener("change", actualizarConfirmacionInventarioPorEstado);
$("#btnCambiarEstado").addEventListener("click", cambiarEstado);
$("#btnAgregarPago").addEventListener("click", abrirPago);
$("#formPago").addEventListener("submit", guardarNuevoPago);
$("#btnAbrirDevolucion").addEventListener("click", abrirDevolucion);
$("#btnImprimir").addEventListener("click", () => imprimirEtiqueta(surtidoActual));
$("#formDevolucion").addEventListener("submit", guardarDevolucion);
$("#formEditarPedido").addEventListener("submit", guardarEdicionPedido);
$("#btnAgregarProductoEdicion").addEventListener("click", () => {
  productosEdicion.push({ idLinea: crypto.randomUUID(), clave: "", nombre: "", costo: 0, cantidad: 1 });
  renderProductosEdicion();
  actualizarTotalEdicion();
});
$("#editarCostoEnvio").addEventListener("input", actualizarTotalEdicion);
$("#tipoDescuento").addEventListener("change", actualizarModoDescuentoNuevo);
$("#descuentoGeneral").addEventListener("input", actualizarTotalNuevo);
$("#editarTipoDescuento").addEventListener("change", actualizarModoDescuentoEdicion);
$("#editarDescuentoGeneral").addEventListener("input", actualizarTotalEdicion);
function aplicarFiltroManual() {
  filtroPagadosPendientesActivo = false;
  renderLista();
}

$("#btnVerPagadosPendientes").addEventListener("click", () => {
  filtroPagadosPendientesActivo = !filtroPagadosPendientesActivo;
  if (filtroPagadosPendientesActivo) {
    $("#buscador").value = "";
    $("#filtroEstado").value = "";
    $("#filtroPago").value = "";
    $("#filtroMetodo").value = "";
    $("#filtroDevolucion").value = "";
  }
  renderLista();
});
$("#buscador").addEventListener("input", aplicarFiltroManual);
$("#filtroEstado").addEventListener("change", aplicarFiltroManual);
$("#filtroPago").addEventListener("change", aplicarFiltroManual);
$("#filtroMetodo").addEventListener("change", aplicarFiltroManual);
$("#filtroDevolucion").addEventListener("change", aplicarFiltroManual);

$("#btnCerrarSesion").addEventListener("click", cerrarSesion);
$("#btnGestionUsuarios").addEventListener("click", abrirGestionUsuarios);
$("#formNuevoUsuario").addEventListener("submit", crearUsuarioSistema);
$("#btnNuevoCliente").addEventListener("click", abrirNuevoCliente);
$("#formNuevoCliente").addEventListener("submit", guardarNuevoCliente);
$("#btnCargaClientes").addEventListener("click", abrirCargaClientes);
$("#archivoClientes").addEventListener("change", prepararArchivoClientes);
$("#btnImportarClientes").addEventListener("click", importarClientesPreparados);
$("#btnPlantillaClientes").addEventListener("click", descargarPlantillaClientes);
$("#nombreCliente").addEventListener("input", () => {
  $("#clienteId").value = "";
  $("#clienteTelefono").value = "";
  $("#clienteSeleccionadoInfo").classList.add("hidden");
  renderResultadosClientes();
});
$("#nombreCliente").addEventListener("focus", renderResultadosClientes);
$("#nombreCliente").addEventListener("blur", () => setTimeout(ocultarResultadosClientes, 180));
$("#resultadosClientes").addEventListener("click", event => {
  const boton = event.target.closest("[data-client-id]");
  if (!boton) return;
  seleccionarCliente(clientesFrecuentes.find(cliente => cliente.id === boton.dataset.clientId));
});

const menuLateral = $("#menuLateral");
const menuOverlay = $("#menuOverlay");
const btnAbrirMenu = $("#btnAbrirMenu");

function alternarMenuLateral(abierto) {
  menuLateral.classList.toggle("open", abierto);
  menuOverlay.classList.toggle("open", abierto);
  btnAbrirMenu.setAttribute("aria-expanded", String(abierto));
  document.body.classList.toggle("menu-open", abierto);
}

btnAbrirMenu.addEventListener("click", () => alternarMenuLateral(true));
$("#btnCerrarMenu").addEventListener("click", () => alternarMenuLateral(false));
menuOverlay.addEventListener("click", () => alternarMenuLateral(false));

document.querySelectorAll(".sidebar-link:not(.sidebar-logout)").forEach(boton => {
  boton.addEventListener("click", () => {
    document.querySelectorAll(".sidebar-link.active").forEach(item => item.classList.remove("active"));
    boton.classList.add("active");
    if (window.matchMedia("(max-width: 900px)").matches) alternarMenuLateral(false);
  });
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && menuLateral.classList.contains("open")) alternarMenuLateral(false);
});

cargarCatalogoProductos();
configurarBotonEscanerMovil();
