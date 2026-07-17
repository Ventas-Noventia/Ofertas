import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, onSnapshot,
  serverTimestamp, query, orderBy, arrayUnion, getDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const $ = (selector) => document.querySelector(selector);
const lista = $("#listaSurtidos");
const modalSurtido = $("#modalSurtido");
const modalDetalle = $("#modalDetalle");
const modalDevolucion = $("#modalDevolucion");

let surtidos = [];
let productosNuevo = [];
let surtidoActual = null;

function escapeHtml(valor = "") {
  return String(valor).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[c]);
}

function fechaLocal(valor) {
  if (!valor) return "Sin fecha";
  const fecha = valor.toDate ? valor.toDate() : new Date(valor);
  return fecha.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function hoyMismo(valor) {
  if (!valor) return false;
  const d = valor.toDate ? valor.toDate() : new Date(valor);
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString();
}

function textoEstado(estado) {
  return ({
    EN_PROCESO: "En proceso",
    FINALIZADO: "Finalizado",
    CON_DEVOLUCION: "Con devolución"
  })[estado] || estado;
}

function totalPiezas(productos = []) {
  return productos.reduce((s, p) => s + Number(p.cantidad || 0), 0);
}

function siguienteFolio() {
  const stamp = Date.now().toString().slice(-6);
  return `S-${stamp}`;
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
  escucharSurtidos();
});

function escucharSurtidos() {
  const q = query(collection(db, "surtidos"), orderBy("creadoEn", "desc"));
  onSnapshot(q, snapshot => {
    surtidos = snapshot.docs.map(d => ({ idFirestore: d.id, ...d.data() }));
    renderLista();
  }, error => {
    $("#estadoConexion").textContent = "Error al leer Firestore. Revisa la configuración y las reglas.";
    console.error(error);
  });
}

function renderLista() {
  const texto = $("#buscador").value.trim().toLowerCase();
  const filtro = $("#filtroEstado").value;

  const filtrados = surtidos.filter(s => {
    const contenido = [
      s.folio, s.responsable,
      ...(s.productos || []).flatMap(p => [p.clave, p.nombre])
    ].join(" ").toLowerCase();
    return (!texto || contenido.includes(texto)) && (!filtro || s.estado === filtro);
  });

  lista.innerHTML = "";
  $("#sinResultados").classList.toggle("hidden", filtrados.length > 0);

  for (const surtido of filtrados) {
    const nodo = $("#templateCard").content.cloneNode(true);
    nodo.querySelector(".card-id").textContent = surtido.folio;
    const status = nodo.querySelector(".status");
    status.textContent = textoEstado(surtido.estado);
    status.classList.add(surtido.estado);
    nodo.querySelector(".card-date").textContent = fechaLocal(surtido.creadoEn);
    nodo.querySelector(".card-responsable").textContent = `Responsable: ${surtido.responsable}`;
    nodo.querySelector(".card-count").textContent =
      `${surtido.productos?.length || 0} productos · ${totalPiezas(surtido.productos)} piezas`;
    nodo.querySelector(".card-open").addEventListener("click", () => abrirDetalle(surtido));
    lista.appendChild(nodo);
  }

  $("#totalHoy").textContent = surtidos.filter(s => hoyMismo(s.creadoEn)).length;
  $("#totalProceso").textContent = surtidos.filter(s => s.estado === "EN_PROCESO").length;
  $("#totalFinalizados").textContent = surtidos.filter(s => s.estado === "FINALIZADO").length;
  $("#totalDevoluciones").textContent = surtidos.filter(s => s.estado === "CON_DEVOLUCION").length;
}

function renderProductosNuevo() {
  const cont = $("#productosNuevo");
  cont.innerHTML = "";
  productosNuevo.forEach((p, index) => {
    const row = document.createElement("div");
    row.className = "product-row";
    row.innerHTML = `
      <div><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.clave || "Sin clave")}</small></div>
      <span>${p.cantidad} pza.</span>
      <button type="button" class="danger">Quitar</button>`;
    row.querySelector("button").addEventListener("click", () => {
      productosNuevo.splice(index, 1);
      renderProductosNuevo();
    });
    cont.appendChild(row);
  });
}

function agregarProducto() {
  const clave = $("#productoClave").value.trim();
  const nombre = $("#productoNombre").value.trim();
  const cantidad = Number($("#productoCantidad").value);

  if (!nombre || !Number.isInteger(cantidad) || cantidad < 1) {
    alert("Escribe el nombre y una cantidad válida.");
    return;
  }

  productosNuevo.push({
    idLinea: crypto.randomUUID(),
    clave,
    nombre,
    cantidad
  });

  $("#productoClave").value = "";
  $("#productoNombre").value = "";
  $("#productoCantidad").value = "1";
  $("#productoClave").focus();
  renderProductosNuevo();
}

async function guardarSurtido(finalizar) {
  const responsable = $("#responsable").value.trim();
  if (!responsable || productosNuevo.length === 0) {
    alert("Agrega el responsable y por lo menos un producto.");
    return;
  }

  if (finalizar) {
    const confirmado = confirm(
      "Antes de continuar, confirma que todos los productos ya fueron descontados en SICAR.\n\n¿Deseas finalizar y generar la etiqueta?"
    );
    if (!confirmado) return;
  }

  const folio = siguienteFolio();
  const registro = {
    folio,
    responsable,
    productos: productosNuevo,
    estado: finalizar ? "FINALIZADO" : "EN_PROCESO",
    creadoEn: serverTimestamp(),
    finalizadoEn: finalizar ? serverTimestamp() : null,
    devoluciones: [],
    historial: [{
      tipo: finalizar ? "SURTIDO_FINALIZADO" : "SURTIDO_CREADO",
      detalle: finalizar ? "Productos descontados en SICAR" : "Guardado en proceso",
      fechaISO: new Date().toISOString()
    }]
  };

  try {
    await addDoc(collection(db, "surtidos"), registro);
    modalSurtido.close();
    $("#formSurtido").reset();
    productosNuevo = [];
    renderProductosNuevo();
    if (finalizar) imprimirEtiqueta({ ...registro, creadoEn: new Date() });
  } catch (error) {
    alert("No se pudo guardar el surtido.");
    console.error(error);
  }
}

function abrirDetalle(surtido) {
  surtidoActual = surtido;
  $("#detalleId").textContent = surtido.folio;
  $("#detalleFecha").textContent = fechaLocal(surtido.creadoEn);

  const productosHtml = (surtido.productos || []).map(p => `
    <div class="product-row">
      <div><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.clave || "Sin clave")}</small></div>
      <span>${p.cantidad} pza.</span>
      <span></span>
    </div>`).join("");

  const devolucionesHtml = (surtido.devoluciones || []).map(d => `
    <div class="history-item">
      <strong>Devolución: ${escapeHtml(d.motivo)}</strong><br>
      <small>${escapeHtml(d.fechaLocal)} · ${escapeHtml(d.observaciones || "Sin observaciones")}</small>
    </div>`).join("");

  $("#detalleContenido").innerHTML = `
    <div class="detail-meta">
      <div><small>Estado</small><strong>${textoEstado(surtido.estado)}</strong></div>
      <div><small>Responsable</small><strong>${escapeHtml(surtido.responsable)}</strong></div>
      <div><small>Piezas</small><strong>${totalPiezas(surtido.productos)}</strong></div>
    </div>
    <h3>Productos</h3>
    <div class="product-list">${productosHtml}</div>
    ${(surtido.devoluciones || []).length ? `<div class="history"><h3>Devoluciones</h3>${devolucionesHtml}</div>` : ""}
  `;

  $("#btnFinalizarExistente").classList.toggle("hidden", surtido.estado !== "EN_PROCESO");
  $("#btnAbrirDevolucion").classList.toggle("hidden", surtido.estado === "EN_PROCESO");
  modalDetalle.showModal();
}

async function finalizarExistente() {
  if (!surtidoActual) return;
  const confirmado = confirm(
    "Confirma que los productos ya fueron descontados en SICAR. Después de finalizar se imprimirá la etiqueta."
  );
  if (!confirmado) return;

  await updateDoc(doc(db, "surtidos", surtidoActual.idFirestore), {
    estado: "FINALIZADO",
    finalizadoEn: serverTimestamp(),
    historial: arrayUnion({
      tipo: "SURTIDO_FINALIZADO",
      detalle: "Productos descontados en SICAR",
      fechaISO: new Date().toISOString()
    })
  });

  modalDetalle.close();
  imprimirEtiqueta(surtidoActual);
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

  if (seleccionados.length === 0) {
    alert("Selecciona por lo menos un producto.");
    return;
  }

  const motivo = $("#motivoDevolucion").value;
  if (!motivo) return;

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
      estado: "CON_DEVOLUCION",
      devoluciones: arrayUnion(devolucion),
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

function imprimirEtiqueta(surtido) {
  const anterior = document.querySelector("#printArea");
  if (anterior) anterior.remove();

  const printArea = document.createElement("section");
  printArea.id = "printArea";
  printArea.innerHTML = `
    <h1 style="font-size:26px;margin:0 0 8px">${escapeHtml(surtido.folio)}</h1>
    <p style="margin:3px 0"><strong>Fecha:</strong> ${fechaLocal(surtido.creadoEn)}</p>
    <p style="margin:3px 0"><strong>Responsable:</strong> ${escapeHtml(surtido.responsable)}</p>
    <p style="margin:3px 0"><strong>Productos:</strong> ${surtido.productos?.length || 0}</p>
    <p style="margin:3px 0"><strong>Piezas:</strong> ${totalPiezas(surtido.productos)}</p>
    <hr>
    ${(surtido.productos || []).map(p =>
      `<p style="font-size:12px;margin:4px 0">${p.cantidad} × ${escapeHtml(p.nombre)}</p>`
    ).join("")}
  `;
  document.body.appendChild(printArea);
  window.print();
}


function exportarPedidos() {
  if (!surtidos.length) {
    alert("No hay pedidos para exportar.");
    return;
  }

  if (typeof XLSX === "undefined") {
    alert("No se pudo cargar el generador de Excel. Revisa tu conexión a internet.");
    return;
  }

  const filasPedidos = surtidos.map(s => ({
    Folio: s.folio || "",
    Fecha: fechaLocal(s.creadoEn),
    Responsable: s.responsable || "",
    Estado: textoEstado(s.estado),
    "Productos distintos": s.productos?.length || 0,
    "Piezas totales": totalPiezas(s.productos),
    "Número de devoluciones": s.devoluciones?.length || 0,
    "Fecha de finalización": fechaLocal(s.finalizadoEn)
  }));

  const filasProductos = [];
  for (const s of surtidos) {
    for (const p of s.productos || []) {
      filasProductos.push({
        Folio: s.folio || "",
        Fecha: fechaLocal(s.creadoEn),
        Responsable: s.responsable || "",
        Estado: textoEstado(s.estado),
        Clave: p.clave || "",
        Producto: p.nombre || "",
        Cantidad: Number(p.cantidad || 0)
      });
    }
  }

  const filasDevoluciones = [];
  for (const s of surtidos) {
    for (const d of s.devoluciones || []) {
      for (const p of d.productos || []) {
        filasDevoluciones.push({
          Folio: s.folio || "",
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
  const hojaPedidos = XLSX.utils.json_to_sheet(filasPedidos);
  const hojaProductos = XLSX.utils.json_to_sheet(filasProductos);
  const hojaDevoluciones = XLSX.utils.json_to_sheet(
    filasDevoluciones.length ? filasDevoluciones : [{
      Folio: "",
      "Fecha devolución": "",
      Motivo: "",
      Observaciones: "",
      Clave: "",
      Producto: "",
      "Cantidad devuelta": "",
      "Reincorporado en SICAR": ""
    }]
  );

  hojaPedidos["!cols"] = [
    { wch: 16 }, { wch: 23 }, { wch: 22 }, { wch: 18 },
    { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 23 }
  ];
  hojaProductos["!cols"] = [
    { wch: 16 }, { wch: 23 }, { wch: 22 }, { wch: 18 },
    { wch: 18 }, { wch: 42 }, { wch: 12 }
  ];
  hojaDevoluciones["!cols"] = [
    { wch: 16 }, { wch: 23 }, { wch: 24 }, { wch: 42 },
    { wch: 18 }, { wch: 42 }, { wch: 20 }, { wch: 24 }
  ];

  XLSX.utils.book_append_sheet(libro, hojaPedidos, "Pedidos");
  XLSX.utils.book_append_sheet(libro, hojaProductos, "Productos");
  XLSX.utils.book_append_sheet(libro, hojaDevoluciones, "Devoluciones");

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(libro, `pedidos-${fecha}.xlsx`);
}


document.addEventListener("click", e => {
  const id = e.target.dataset.close;
  if (id) document.getElementById(id).close();
});

$("#btnExportar").addEventListener("click", exportarPedidos);
$("#btnNuevo").addEventListener("click", () => {
  productosNuevo = [];
  renderProductosNuevo();
  modalSurtido.showModal();
});
$("#btnAgregarProducto").addEventListener("click", agregarProducto);
$("#btnGuardarBorrador").addEventListener("click", () => guardarSurtido(false));
$("#btnFinalizarNuevo").addEventListener("click", () => guardarSurtido(true));
$("#btnFinalizarExistente").addEventListener("click", finalizarExistente);
$("#btnAbrirDevolucion").addEventListener("click", abrirDevolucion);
$("#btnImprimir").addEventListener("click", () => imprimirEtiqueta(surtidoActual));
$("#formDevolucion").addEventListener("submit", guardarDevolucion);
$("#buscador").addEventListener("input", renderLista);
$("#filtroEstado").addEventListener("change", renderLista);

iniciar();
