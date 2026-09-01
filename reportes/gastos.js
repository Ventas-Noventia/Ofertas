import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  getApp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";


let iniciado = false;
let guardando = false;
let gastosRegistrados = [];
const suscriptoresGastos = new Set();
let urlComprobanteActual = null;

const conceptosIniciales = [
  "Limpieza",
  "Luz",
  "Internet",
  "Accesorios de papelería"
];

const $ = selector => document.querySelector(selector);

const db = getFirestore(getApp());
const auth = getAuth(getApp());


export function inicializarGastos() {
  if (iniciado) return;

  iniciado = true;

  actualizarFechaPantalla();
  cargarConceptos();
  escucharGastos();

  $("#btnMostrarFormularioGasto")
    .addEventListener("click", mostrarFormulario);

  $("#btnCancelarGasto")
    .addEventListener("click", cerrarFormulario);

  $("#conceptoGasto")
    .addEventListener("change", cambiarConcepto);

  $("#formGasto")
    .addEventListener("submit", guardarGasto);

  $("#tablaGastos")
    .addEventListener("click", manejarComprobante);

  $("#btnCerrarComprobanteGasto")
    .addEventListener("click", cerrarComprobante);

  $("#visorComprobanteGasto")
    .addEventListener("close", limpiarComprobante);

  setInterval(actualizarFechaPantalla, 30000);
}

export function obtenerGastosRegistrados() {
  return [...gastosRegistrados];
}

export function suscribirCambiosGastos(listener) {
  if (typeof listener !== "function") return () => {};
  suscriptoresGastos.add(listener);
  listener(obtenerGastosRegistrados());
  return () => suscriptoresGastos.delete(listener);
}

export function aplicarFiltroGastos({ rango, metodo = "", fechaEnRango }) {
  if (!rango || typeof fechaEnRango !== "function") {
    renderGastos([]);
    return;
  }

  const filtrados = gastosRegistrados.filter(gasto => {
    const fecha = gasto.creadoEn?.toDate?.();
    if (!fecha) return false;

    return fechaEnRango(
      fechaLocalISO(fecha),
      rango.inicio,
      rango.fin
    ) && (!metodo || gasto.metodo === metodo);
  });

  renderGastos(filtrados);
}


function actualizarFechaPantalla() {
  const campo = $("#fechaGastoActual");

  if (!campo) return;

  campo.value = new Date().toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}


function mostrarFormulario() {
  $("#formularioGastoCaja").classList.remove("hidden");
  actualizarFechaPantalla();
  $("#conceptoGasto").focus();
}


function cerrarFormulario() {
  if (guardando) return;

  $("#formGasto").reset();
  $("#formularioGastoCaja").classList.add("hidden");
  $("#campoOtroConceptoGasto").classList.add("hidden");
  $("#otroConceptoGasto").required = false;
  $("#mensajeGasto").textContent = "";
  actualizarFechaPantalla();
}


function cambiarConcepto() {
  const esOtro =
    $("#conceptoGasto").value === "__OTRO__";

  $("#campoOtroConceptoGasto")
    .classList.toggle("hidden", !esOtro);

  $("#otroConceptoGasto").required = esOtro;

  if (esOtro) {
    $("#otroConceptoGasto").focus();
  } else {
    $("#otroConceptoGasto").value = "";
    $("#guardarConceptoGasto").checked = false;
  }
}


function cargarConceptos() {
  onSnapshot(
    collection(db, "conceptosGasto"),

    snapshot => {
      const personalizados = snapshot.docs
        .map(documento => documento.data().nombre)
        .filter(Boolean);

      mostrarConceptos([
        ...conceptosIniciales,
        ...personalizados
      ]);
    },

    error => {
      console.error(
        "Error al cargar conceptos de gastos:",
        error
      );

      mostrarConceptos(conceptosIniciales);
    }
  );
}


function mostrarConceptos(conceptos) {
  const select = $("#conceptoGasto");
  const seleccionAnterior = select.value;

  const unicos = [...new Set(conceptos)]
    .sort((a, b) => a.localeCompare(b, "es"));

  select.innerHTML = `
    <option value="">Selecciona un concepto</option>

    ${unicos.map(concepto => `
      <option value="${escaparHtml(concepto)}">
        ${escaparHtml(concepto)}
      </option>
    `).join("")}

    <option value="__OTRO__">Otro</option>
  `;

  if (
    seleccionAnterior === "__OTRO__" ||
    unicos.includes(seleccionAnterior)
  ) {
    select.value = seleccionAnterior;
  }
}


function escucharGastos() {
  onSnapshot(
    collection(db, "gastos"),

    snapshot => {
      gastosRegistrados = snapshot.docs
        .map(documento => ({
          id: documento.id,
          ...documento.data()
        }))
        .sort((a, b) => {
          const fechaA =
            a.creadoEn?.toMillis?.() || 0;

          const fechaB =
            b.creadoEn?.toMillis?.() || 0;

          return fechaB - fechaA;
        });

      renderGastos();

      for (const listener of suscriptoresGastos) {
        listener(obtenerGastosRegistrados());
      }
    },

    error => {
      console.error("Error al consultar gastos:", error);

      $("#sinGastos").textContent =
        "No fue posible consultar los gastos. " +
        "Revisa las reglas de Firestore.";
    }
  );
}


async function guardarGasto(event) {
  event.preventDefault();

  if (guardando) return;

  const usuario = auth.currentUser;

  if (!usuario) {
    mostrarMensaje(
      "La sesión ya no está disponible.",
      true
    );
    return;
  }

  const opcionConcepto =
    $("#conceptoGasto").value;

  const concepto = (
    opcionConcepto === "__OTRO__"
      ? $("#otroConceptoGasto").value
      : opcionConcepto
  ).trim();

  const monto = Number($("#montoGasto").value);
  const metodo = $("#metodoGasto").value;
  const archivo = $("#comprobanteGasto").files[0];

  if (!concepto || concepto.length > 100) {
    mostrarMensaje(
      "Selecciona o escribe un concepto válido.",
      true
    );
    return;
  }

  if (
    !Number.isFinite(monto) ||
    monto <= 0 ||
    monto > 99999999.99 ||
    Math.abs(
      monto * 100 - Math.round(monto * 100)
    ) > 0.00001
  ) {
    mostrarMensaje(
      "Ingresa un monto válido con máximo dos decimales.",
      true
    );
    return;
  }

  if (
    !["EFECTIVO", "TRANSFERENCIA"].includes(metodo)
  ) {
    mostrarMensaje(
      "Selecciona el tipo de pago.",
      true
    );
    return;
  }

  guardando = true;
  bloquearFormulario(true);
  mostrarMensaje("Guardando gasto…");

  try {
    const imagen = archivo
      ? await comprimirImagen(archivo)
      : null;

    const referenciaGasto =
      doc(collection(db, "gastos"));

    const lote = writeBatch(db);

    lote.set(referenciaGasto, {
      concepto,
      montoCentavos: Math.round(monto * 100),
      metodo,
      creadoEn: serverTimestamp(),
      creadoPor: usuario.uid,
      tieneComprobante: Boolean(imagen)
    });

    if (imagen) {
      lote.set(
        doc(
          db,
          "comprobantesGasto",
          referenciaGasto.id
        ),
        {
          imagen,
          creadoEn: serverTimestamp(),
          creadoPor: usuario.uid
        }
      );
    }

    if (
      opcionConcepto === "__OTRO__" &&
      $("#guardarConceptoGasto").checked
    ) {
      const idConcepto =
        await generarIdConcepto(concepto);

      lote.set(
        doc(db, "conceptosGasto", idConcepto),
        {
          nombre: concepto
        }
      );
    }

    await lote.commit();

    $("#formGasto").reset();
    cambiarConcepto();
    actualizarFechaPantalla();

    mostrarMensaje(
      `Gasto guardado. ID: ${referenciaGasto.id}`
    );

  } catch (error) {
    console.error("Error al guardar gasto:", error);

    mostrarMensaje(
      error.code === "permission-denied"
        ? "Firebase rechazó el registro. Revisa que " +
          "las reglas estén publicadas y tu usuario sea administrador."
        : `No se pudo guardar el gasto: ${error.message}`,
      true
    );

  } finally {
    guardando = false;
    bloquearFormulario(false);
  }
}


function bloquearFormulario(bloquear) {
  $("#btnGuardarGasto").disabled = bloquear;
  $("#btnCancelarGasto").disabled = bloquear;
  $("#btnMostrarFormularioGasto").disabled = bloquear;
}


function mostrarMensaje(texto, error = false) {
  const mensaje = $("#mensajeGasto");

  mensaje.textContent = texto;
  mensaje.classList.toggle("form-error", error);
  mensaje.classList.toggle("form-success", !error);
}


function renderGastos(lista = gastosRegistrados) {
  const tabla = $("#tablaGastos");

  tabla.innerHTML = "";

  let efectivoCentavos = 0;
  let transferenciaCentavos = 0;

  for (const gasto of lista) {
    const montoCentavos =
      Number(gasto.montoCentavos || 0);

    if (gasto.metodo === "EFECTIVO") {
      efectivoCentavos += montoCentavos;
    }

    if (gasto.metodo === "TRANSFERENCIA") {
      transferenciaCentavos += montoCentavos;
    }

    const fecha = gasto.creadoEn?.toDate?.();

    const fila = document.createElement("tr");

    fila.innerHTML = `
      <td>${escaparHtml(gasto.id)}</td>

      <td>
        ${fecha
          ? escaparHtml(fecha.toLocaleString("es-MX"))
          : "Registrando…"
        }
      </td>

      <td>${escaparHtml(gasto.concepto)}</td>

      <td>
        ${gasto.metodo === "EFECTIVO"
          ? "Efectivo"
          : "Transferencia"
        }
      </td>

      <td class="money-cell">
        ${monedaDesdeCentavos(montoCentavos)}
      </td>

      <td>
        ${gasto.tieneComprobante
          ? `
            <button
              type="button"
              class="secondary gasto-action"
              data-ver-comprobante="${gasto.id}"
            >
              Ver
            </button>

            <button
              type="button"
              class="secondary gasto-action"
              data-descargar-comprobante="${gasto.id}"
            >
              Descargar
            </button>
          `
          : "Sin comprobante"
        }
      </td>
    `;

    tabla.appendChild(fila);
  }

  const totalCentavos =
    efectivoCentavos + transferenciaCentavos;

  $("#totalGastosRegistrados").textContent =
    monedaDesdeCentavos(totalCentavos);

  $("#totalGastosEfectivo").textContent =
    monedaDesdeCentavos(efectivoCentavos);

  $("#totalGastosTransferencia").textContent =
    monedaDesdeCentavos(transferenciaCentavos);

  $("#cantidadGastos").textContent =
    String(lista.length);

  $("#sinGastos").classList.toggle(
    "hidden",
    lista.length > 0
  );
}

function fechaLocalISO(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}


async function manejarComprobante(event) {
  const boton = event.target.closest(
    "[data-ver-comprobante]," +
    "[data-descargar-comprobante]"
  );

  if (!boton) return;

  const gastoId =
    boton.dataset.verComprobante ||
    boton.dataset.descargarComprobante;

  boton.disabled = true;

  try {
    const resultado = await getDoc(
      doc(db, "comprobantesGasto", gastoId)
    );

    if (!resultado.exists()) {
      throw new Error(
        "El comprobante no está disponible."
      );
    }

    const imagen = resultado.data().imagen;

    if (
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/
        .test(imagen || "")
    ) {
      throw new Error(
        "El formato del comprobante no es válido."
      );
    }

    const blob = convertirDataUrlABlob(imagen);
    const url = URL.createObjectURL(blob);

    if (boton.dataset.verComprobante) {
      limpiarComprobante();

      urlComprobanteActual = url;

      $("#imagenComprobanteGasto").src = url;
      $("#visorComprobanteGasto").showModal();

    } else {
      const enlace = document.createElement("a");

      enlace.href = url;
      enlace.download =
        `comprobante-${gastoId}.jpg`;

      enlace.click();

      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    }

  } catch (error) {
    console.error(
      "Error al consultar comprobante:",
      error
    );

    alert(
      `No se pudo abrir el comprobante: ${error.message}`
    );

  } finally {
    boton.disabled = false;
  }
}


function cerrarComprobante() {
  $("#visorComprobanteGasto").close();
}


function limpiarComprobante() {
  if (urlComprobanteActual) {
    URL.revokeObjectURL(urlComprobanteActual);
    urlComprobanteActual = null;
  }

  $("#imagenComprobanteGasto")
    .removeAttribute("src");
}


async function comprimirImagen(archivo) {
  const formatosPermitidos = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!formatosPermitidos.includes(archivo.type)) {
    throw new Error(
      "El comprobante debe ser JPG, PNG o WebP."
    );
  }

  if (archivo.size > 10 * 1024 * 1024) {
    throw new Error(
      "El comprobante no puede superar 10 MB."
    );
  }

  const imagen = await createImageBitmap(archivo);

  try {
    const escala = Math.min(
      1,
      1600 / Math.max(imagen.width, imagen.height)
    );

    const canvas = document.createElement("canvas");

    canvas.width = Math.max(
      1,
      Math.round(imagen.width * escala)
    );

    canvas.height = Math.max(
      1,
      Math.round(imagen.height * escala)
    );

    const contexto = canvas.getContext("2d");

    contexto.fillStyle = "#ffffff";
    contexto.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    contexto.drawImage(
      imagen,
      0,
      0,
      canvas.width,
      canvas.height
    );

    for (const calidad of [0.85, 0.70, 0.55, 0.40]) {
      const resultado =
        canvas.toDataURL("image/jpeg", calidad);

      if (resultado.length <= 700000) {
        return resultado;
      }
    }

    throw new Error(
      "La imagen sigue siendo demasiado grande. " +
      "Recórtala e intenta nuevamente."
    );

  } finally {
    imagen.close();
  }
}


function convertirDataUrlABlob(dataUrl) {
  const contenidoBase64 = dataUrl.split(",")[1];
  const contenidoBinario = atob(contenidoBase64);

  const bytes = Uint8Array.from(
    contenidoBinario,
    caracter => caracter.charCodeAt(0)
  );

  return new Blob(
    [bytes],
    { type: "image/jpeg" }
  );
}


async function generarIdConcepto(concepto) {
  const contenido = new TextEncoder().encode(
    concepto.trim().toLocaleLowerCase("es")
  );

  const hash = await crypto.subtle.digest(
    "SHA-256",
    contenido
  );

  return Array.from(
    new Uint8Array(hash),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}


function monedaDesdeCentavos(centavos) {
  return (Number(centavos || 0) / 100)
    .toLocaleString("es-MX", {
      style: "currency",
      currency: "MXN"
    });
}


function escaparHtml(valor = "") {
  return String(valor).replace(
    /[&<>"']/g,
    caracter => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[caracter]
  );
}
