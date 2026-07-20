import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, onSnapshot,
  serverTimestamp, query, orderBy, arrayUnion
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

const $ = selector => document.querySelector(selector);
const lista = $("#listaSurtidos");
const modalSurtido = $("#modalSurtido");
const modalDetalle = $("#modalDetalle");
const modalDevolucion = $("#modalDevolucion");

let surtidos = [];
let productosNuevo = [];
let surtidoActual = null;

const ESTADOS = {
  EN_PROCESO: "En proceso",
  ENVIADO: "Enviado",
  CON_REPARTIDOR: "Con repartidor",
  ENTREGADO: "Entregado",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
  CON_DEVOLUCION: "Con devolución"
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

function hoyMismo(s) {
  return s.fechaPedido === fechaSoloDia() || (!s.fechaPedido && s.creadoEn &&
    (s.creadoEn.toDate ? s.creadoEn.toDate() : new Date(s.creadoEn)).toDateString() === new Date().toDateString());
}

function textoEstado(estado) {
  return ESTADOS[estado] || estado || "Sin estado";
}

function textoPago(pago) {
  return pago === "APARTADO" ? "Apartado" : pago === "PAGADO" ? "Pagado" : "Sin definir";
}

function totalPiezas(productos = []) {
  return productos.reduce((sum, p) => sum + Number(p.cantidad || 0), 0);
}

function totalPedido(productos = []) {
  return productos.reduce((sum, p) => sum + Number(p.cantidad || 0) * Number(p.costo || 0), 0);
}

function siguienteFolio(tipo) {
  const hoy = fechaSoloDia().replaceAll("-", "");
  const consecutivo = Date.now().toString().slice(-5);
  return `${tipo}-${hoy}-${consecutivo}`;
}

function transicionesPermitidas(estadoActual) {
  const mapa = {
    EN_PROCESO: ["ENVIADO", "CANCELADO"],
    ENVIADO: ["CON_REPARTIDOR", "CANCELADO"],
    CON_REPARTIDOR: ["ENTREGADO", "CANCELADO"],
    ENTREGADO: ["FINALIZADO"],
    FINALIZADO: [],
    CANCELADO: []
  };
  return mapa[estadoActual] || ["EN_PROCESO", "ENVIADO", "CON_REPARTIDOR", "ENTREGADO", "FINALIZADO", "CANCELADO"];
}

async function iniciar() {
  try {
    await signInAnonymously(auth);
  } catch (error) {
    $("#estadoConexion").textContent = "No se pudo iniciar sesión anónima. Revisa Firebase Authentication.";
    console.error(error);
  }
}

onAuthStateChanged(auth, user => {
  if (!user) return;
  $("#estadoConexion").textContent = "Conectado. Los cambios se guardan automáticamente.";
  const q = query(collection(db, "surtidos"), orderBy("creadoEn", "desc"));
  onSnapshot(q, snapshot => {
    surtidos = snapshot.docs.map(d => ({ idFirestore: d.id, ...d.data() }));
    renderLista();
  }, error => {
    $("#estadoConexion").textContent = "Error al leer Firestore. Revisa la configuración y las reglas.";
    console.error(error);
  });
});

function renderLista() {
  const texto = $("#buscador").value.trim().toLowerCase();
  const filtro = $("#filtroEstado").value;

  const filtrados = surtidos.filter(s => {
    const contenido = [
      s.folio, s.nombreCliente, s.ubicacion, s.responsable, s.vendedor,
      ...(s.productos || []).flatMap(p => [p.clave, p.nombre])
    ].filter(Boolean).join(" ").toLowerCase();
    return (!texto || contenido.includes(texto)) && (!filtro || s.estado === filtro);
  });

  lista.innerHTML = "";
  $("#sinResultados").classList.toggle("hidden", filtrados.length > 0);

  for (const s of filtrados) {
    const nodo = $("#templateCard").content.cloneNode(true);
    nodo.querySelector(".card-id").textContent = s.folio || "Sin folio";
    const status = nodo.querySelector(".status");
    status.textContent = textoEstado(s.estado);
    status.classList.add(s.estado || "EN_PROCESO");
    nodo.querySelector(".card-client").textContent = s.nombreCliente || "Cliente no registrado";
    nodo.querySelector(".card-date").textContent = `Fecha: ${fechaPedidoTexto(s)}`;
    nodo.querySelector(".card-location").textContent = `Ubicación: ${s.ubicacion || "Sin ubicación"}`;
    nodo.querySelector(".card-payment").textContent =
      `Pago: ${textoPago(s.estatusPago)} · Total: ${moneda(s.total || totalPedido(s.productos))}`;
    nodo.querySelector(".card-count").textContent =
      `${s.productos?.length || 0} productos · ${totalPiezas(s.productos)} piezas${(s.devoluciones || []).length ? " · Con devolución" : ""}`;
    nodo.querySelector(".card-open").addEventListener("click", () => abrirDetalle(s));
    lista.appendChild(nodo);
  }

  $("#totalHoy").textContent = surtidos.filter(hoyMismo).length;
  $("#totalProceso").textContent = surtidos.filter(s => s.estado === "EN_PROCESO").length;
  $("#totalRuta").textContent = surtidos.filter(s => ["ENVIADO", "CON_REPARTIDOR"].includes(s.estado)).length;
  $("#totalFinalizados").textContent = surtidos.filter(s => ["ENTREGADO", "FINALIZADO"].includes(s.estado)).length;
}

function actualizarTotalNuevo() {
  $("#totalNuevo").textContent = moneda(totalPedido(productosNuevo));
}

function renderProductosNuevo() {
  const cont = $("#productosNuevo");
  cont.innerHTML = "";
  productosNuevo.forEach((p, index) => {
    const row = document.createElement("div");
    row.className = "product-row";
    row.innerHTML = `
      <div><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.clave || "Sin clave")}</small></div>
      <span>${moneda(p.costo)} c/u</span>
      <span>${p.cantidad} pza.</span>
      <button type="button" class="danger">Quitar</button>`;
    row.querySelector("button").addEventListener("click", () => {
      productosNuevo.splice(index, 1);
      renderProductosNuevo();
      actualizarTotalNuevo();
    });
    cont.appendChild(row);
  });
}

function agregarProducto() {
  const clave = $("#productoClave").value.trim();
  const nombre = $("#productoNombre").value.trim();
  const costo = Number($("#productoCosto").value);
  const cantidad = Number($("#productoCantidad").value);

  if (!nombre) return alert("Escribe el nombre del producto.");
  if (!Number.isFinite(costo) || costo <= 0) return alert("El costo debe ser mayor a cero.");
  if (!Number.isInteger(cantidad) || cantidad < 1) return alert("La cantidad debe ser un número entero mayor a cero.");

  productosNuevo.push({
    idLinea: crypto.randomUUID(),
    clave,
    nombre,
    costo,
    cantidad
  });

  $("#productoClave").value = "";
  $("#productoNombre").value = "";
  $("#productoCosto").value = "";
  $("#productoCantidad").value = "1";
  $("#productoClave").focus();
  renderProductosNuevo();
  actualizarTotalNuevo();
}

function validarPedido() {
  const campos = [
    ["tipoOperacion", "Selecciona Bazar o Almacén."],
    ["nombreCliente", "Escribe el nombre del cliente."],
    ["ubicacion", "Escribe la ubicación."],
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
  if (!productosNuevo.length) {
    alert("Agrega por lo menos un producto.");
    return false;
  }
  const total = totalPedido(productosNuevo);
  if ($("#estatusPago").value === "APARTADO") {
    const apartado = Number($("#montoApartado").value);
    if (!Number.isFinite(apartado) || apartado <= 0) {
      alert("Escribe una cantidad válida para el apartado.");
      return false;
    }
    if (apartado > total) {
      alert("El apartado no puede ser mayor al total del pedido.");
      return false;
    }
  }
  return true;
}

async function guardarPedido(imprimir) {
  if (!validarPedido()) return;

  const tipoOperacion = $("#tipoOperacion").value;
  const estatusPago = $("#estatusPago").value;
  const estado = $("#estadoInicial").value;
  const total = totalPedido(productosNuevo);

  const registro = {
    folio: siguienteFolio(tipoOperacion),
    fechaPedido: $("#fechaPedido").value,
    tipoOperacion,
    nombreCliente: $("#nombreCliente").value.trim(),
    ubicacion: $("#ubicacion").value.trim(),
    responsable: $("#responsable").value,
    vendedor: $("#vendedor").value.trim(),
    estatusPago,
    montoApartado: estatusPago === "APARTADO" ? Number($("#montoApartado").value) : total,
    productos: productosNuevo,
    total,
    estado,
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

  const productosHtml = (s.productos || []).map(p => `
    <div class="product-row">
      <div><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.clave || "Sin clave")}</small></div>
      <span>${moneda(p.costo || 0)} c/u</span>
      <span>${p.cantidad} pza.</span>
      <strong>${moneda(Number(p.cantidad || 0) * Number(p.costo || 0))}</strong>
    </div>`).join("");

  const devolucionesHtml = (s.devoluciones || []).map(d => `
    <div class="history-item">
      <strong>Devolución: ${escapeHtml(d.motivo)}</strong><br>
      <small>${escapeHtml(d.fechaLocal)} · ${escapeHtml(d.observaciones || "Sin observaciones")}</small>
    </div>`).join("");

  $("#detalleContenido").innerHTML = `
    <div class="detail-meta">
      <div><small>Cliente</small><strong>${escapeHtml(s.nombreCliente || "No registrado")}</strong></div>
      <div><small>Ubicación</small><strong>${escapeHtml(s.ubicacion || "No registrada")}</strong></div>
      <div><small>Nomenclatura</small><strong>${s.tipoOperacion === "ALM" ? "Almacén" : s.tipoOperacion === "BAZ" ? "Bazar" : "Anterior"}</strong></div>
      <div><small>Estado</small><strong>${textoEstado(s.estado)}</strong></div>
      <div><small>Pago</small><strong>${textoPago(s.estatusPago)}${s.estatusPago === "APARTADO" ? ` (${moneda(s.montoApartado)})` : ""}</strong></div>
      <div><small>Total</small><strong>${moneda(s.total || totalPedido(s.productos))}</strong></div>
      <div><small>Responsable</small><strong>${escapeHtml(s.responsable || "No registrado")}</strong></div>
      <div><small>Vendedor</small><strong>${escapeHtml(s.vendedor || "No registrado")}</strong></div>
      <div><small>Piezas</small><strong>${totalPiezas(s.productos)}</strong></div>
    </div>
    <h3>Productos</h3>
    <div class="product-list">${productosHtml}</div>
    ${(s.devoluciones || []).length ? `<div class="history"><h3 class="return-flag">Devoluciones</h3>${devolucionesHtml}</div>` : ""}
  `;

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

  $("#btnAbrirDevolucion").classList.toggle("hidden", ["EN_PROCESO", "CANCELADO"].includes(s.estado));
  modalDetalle.showModal();
}

async function cambiarEstado() {
  if (!surtidoActual) return;
  const nuevoEstado = $("#cambiarEstado").value;
  if (!nuevoEstado) return;

  const mensaje = nuevoEstado === "CANCELADO"
    ? "¿Seguro que deseas cancelar este pedido?"
    : `¿Cambiar el pedido a "${textoEstado(nuevoEstado)}"?`;

  if (!confirm(mensaje)) return;

  try {
    await updateDoc(doc(db, "surtidos", surtidoActual.idFirestore), {
      estado: nuevoEstado,
      actualizadoEn: serverTimestamp(),
      finalizadoEn: nuevoEstado === "FINALIZADO" ? serverTimestamp() : surtidoActual.finalizadoEn || null,
      historial: arrayUnion({
        tipo: "CAMBIO_ESTADO",
        detalle: `Estado cambiado de ${textoEstado(surtidoActual.estado)} a ${textoEstado(nuevoEstado)}`,
        fechaISO: new Date().toISOString()
      })
    });
    modalDetalle.close();
  } catch (error) {
    alert("No se pudo actualizar el estado.");
    console.error(error);
  }
}

function abrirDevolucion() {
  if (!surtidoActual) return;
  $("#devolucionId").textContent = surtidoActual.folio;
  const cont = $("#productosDevolucion");
  cont.innerHTML = "";

  for (const p of surtidoActual.productos || []) {
    const row = document.createElement("label");
    row.className = "return-row";
    row.innerHTML = `
      <input type="checkbox" data-id="${p.idLinea}">
      <span><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.clave || "Sin clave")}</small></span>
      <input type="number" min="1" max="${p.cantidad}" value="1" disabled>`;
    const check = row.querySelector('input[type="checkbox"]');
    const qty = row.querySelector('input[type="number"]');
    check.addEventListener("change", () => qty.disabled = !check.checked);
    cont.appendChild(row);
  }

  modalDetalle.close();
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
      return { ...original, cantidadDevuelta: Number(row.querySelector('input[type="number"]').value) };
    });

  if (!seleccionados.length) return alert("Selecciona por lo menos un producto.");

  const motivo = $("#motivoDevolucion").value;
  if (!motivo) return alert("Selecciona el motivo de devolución.");

  const devolucion = {
    id: crypto.randomUUID(),
    productos: seleccionados,
    motivo,
    observaciones: $("#observacionesDevolucion").value.trim(),
    reincorporadoSicar: true,
    fechaISO: new Date().toISOString(),
    fechaLocal: new Date().toLocaleString("es-MX")
  };

  try {
    await updateDoc(doc(db, "surtidos", surtidoActual.idFirestore), {
      devoluciones: arrayUnion(devolucion),
      actualizadoEn: serverTimestamp(),
      historial: arrayUnion({
        tipo: "DEVOLUCION",
        detalle: `${seleccionados.length} producto(s): ${motivo}`,
        fechaISO: new Date().toISOString()
      })
    });
    modalDevolucion.close();
    $("#formDevolucion").reset();
  } catch (error) {
    alert("No se pudo guardar la devolución.");
    console.error(error);
  }
}

function imprimirEtiqueta(s) {
  const anterior = document.querySelector("#printArea");
  if (anterior) anterior.remove();

  const printArea = document.createElement("section");
  printArea.id = "printArea";
  printArea.innerHTML = `
    <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:7px">
      <strong style="font-size:18px">${s.tipoOperacion === "ALM" ? "ALMACÉN" : "BAZAR"}</strong>
      <h1 style="font-size:23px;margin:4px 0">${escapeHtml(s.folio || "")}</h1>
    </div>
    <p style="margin:3px 0"><strong>Fecha:</strong> ${escapeHtml(fechaPedidoTexto(s))}</p>
    <p style="margin:3px 0"><strong>Cliente:</strong> ${escapeHtml(s.nombreCliente || "")}</p>
    <p style="margin:3px 0"><strong>Pago:</strong> ${textoPago(s.estatusPago)}${s.estatusPago === "APARTADO" ? ` — ${moneda(s.montoApartado)}` : ""}</p>
    <p style="margin:3px 0"><strong>Ubicación:</strong> ${escapeHtml(s.ubicacion || "")}</p>
    <hr>
    <strong>Productos:</strong>
    ${(s.productos || []).map(p =>
      `<p style="font-size:12px;margin:4px 0">${p.cantidad} × ${escapeHtml(p.nombre)}</p>`
    ).join("")}
  `;
  document.body.appendChild(printArea);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}

function exportarPedidos() {
  if (!surtidos.length) return alert("No hay pedidos para exportar.");
  if (typeof XLSX === "undefined") return alert("No se pudo cargar el generador de Excel.");

  const filasPedidos = surtidos.map(s => ({
    Folio: s.folio || "",
    Fecha: fechaPedidoTexto(s),
    Nomenclatura: s.tipoOperacion === "ALM" ? "Almacén" : s.tipoOperacion === "BAZ" ? "Bazar" : "",
    Cliente: s.nombreCliente || "",
    Ubicación: s.ubicacion || "",
    Responsable: s.responsable || "",
    Vendedor: s.vendedor || "",
    Estado: textoEstado(s.estado),
    "Estatus de pago": textoPago(s.estatusPago),
    "Monto apartado": s.estatusPago === "APARTADO" ? Number(s.montoApartado || 0) : "",
    Total: Number(s.total || totalPedido(s.productos)),
    "Productos distintos": s.productos?.length || 0,
    "Piezas totales": totalPiezas(s.productos),
    "Número de devoluciones": s.devoluciones?.length || 0
  }));

  const filasProductos = [];
  for (const s of surtidos) {
    for (const p of s.productos || []) {
      filasProductos.push({
        Folio: s.folio || "",
        Fecha: fechaPedidoTexto(s),
        Cliente: s.nombreCliente || "",
        Clave: p.clave || "",
        Producto: p.nombre || "",
        "Costo unitario": Number(p.costo || 0),
        Cantidad: Number(p.cantidad || 0),
        Subtotal: Number(p.costo || 0) * Number(p.cantidad || 0)
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
          "Reincorporado en SICAR": d.reincorporadoSicar ? "Sí" : "No"
        });
      }
    }
  }

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasPedidos), "Pedidos");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasProductos), "Productos");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasDevoluciones.length ? filasDevoluciones : [{ Folio: "" }]), "Devoluciones");
  XLSX.writeFile(libro, `pedidos-${fechaSoloDia()}.xlsx`);
}

document.addEventListener("click", e => {
  const id = e.target.dataset.close;
  if (id) document.getElementById(id).close();
});

$("#estatusPago").addEventListener("change", () => {
  const apartado = $("#estatusPago").value === "APARTADO";
  $("#campoMontoApartado").classList.toggle("hidden", !apartado);
  $("#montoApartado").required = apartado;
  if (!apartado) $("#montoApartado").value = "";
});

$("#btnNuevo").addEventListener("click", () => {
  $("#formSurtido").reset();
  $("#fechaPedido").value = fechaSoloDia();
  $("#estadoInicial").value = "EN_PROCESO";
  productosNuevo = [];
  renderProductosNuevo();
  actualizarTotalNuevo();
  $("#campoMontoApartado").classList.add("hidden");
  modalSurtido.showModal();
});

$("#btnExportar").addEventListener("click", exportarPedidos);
$("#btnAgregarProducto").addEventListener("click", agregarProducto);
$("#btnGuardarBorrador").addEventListener("click", () => guardarPedido(false));
$("#btnFinalizarNuevo").addEventListener("click", () => guardarPedido(true));
$("#btnCambiarEstado").addEventListener("click", cambiarEstado);
$("#btnAbrirDevolucion").addEventListener("click", abrirDevolucion);
$("#btnImprimir").addEventListener("click", () => imprimirEtiqueta(surtidoActual));
$("#formDevolucion").addEventListener("submit", guardarDevolucion);
$("#buscador").addEventListener("input", renderLista);
$("#filtroEstado").addEventListener("change", renderLista);

iniciar();
