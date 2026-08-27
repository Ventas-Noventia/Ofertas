import { firebaseConfig } from "../firebase-config.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";


const firebaseApp =
  initializeApp(firebaseConfig);

const db =
  getFirestore(firebaseApp);

const auth =
  getAuth(firebaseApp);


const WHATSAPP_GENERAL =
  "525516792785";


const $ =
  selector =>
    document.querySelector(selector);


let archivoFoto =
  null;


let fotoLocal =
  "";


let publicacionActual =
  null;


function moneda(valor) {

  return Number(valor || 0)
    .toLocaleString(
      "es-MX",
      {
        style: "currency",
        currency: "MXN"
      }
    );

}


function mostrarEstado(
  texto,
  error = false
) {

  const elemento =
    $("#mensajeEstado");


  if (!elemento) return;


  elemento.textContent =
    texto;


  elemento.className =
    error
      ? "status error"
      : "status";

}


function obtenerUrlBase() {

  const url =
    new URL(
      window.location.href
    );


  url.search = "";
  url.hash = "";


  return url.toString();

}


function construirLinkCorto(id) {

  const url =
    new URL(
      window.location.href
    );

  url.search = "";
  url.hash = "";

  // Evita mostrar index.html en la liga.
  url.pathname =
    url.pathname.replace(
      /index\.html$/i,
      ""
    );

  url.searchParams.set(
    "p",
    id
  );

  return url.toString();

}


async function generarIdCortoDisponible() {

  // Código de 6 dígitos fácil de leer y compartir.
  for (
    let intento = 0;
    intento < 12;
    intento += 1
  ) {

    const id =
      String(
        Math.floor(
          100000 +
          Math.random() * 900000
        )
      );

    const referencia =
      doc(
        db,
        "publicaciones_whatsapp",
        id
      );

    const existente =
      await getDoc(
        referencia
      );

    if (!existente.exists()) {
      return id;
    }

  }

  throw new Error(
    "No se pudo generar una referencia disponible."
  );

}


function textoPublicacion(
  publicacion
) {

  return [
    `🛍️ ${publicacion.producto}`,
    `💰 ${moneda(publicacion.precio)}`,
    "",
    "¿Te interesa este producto?",
    "Da clic aquí 👇",
    publicacion.link
  ].join("\n");

}


function construirMensajeWhatsapp({
  id,
  producto,
  precio,
  vendedor
}) {

  return [
    "Hola 👋",
    "",
    "Quiero comprar este producto:",
    "",
    `Referencia: ${id}`,
    `Producto: ${producto}`,
    `Precio: ${moneda(precio)}`,
    `Publicado por: ${vendedor}`,
    "",
    "¿Me apoyan con la disponibilidad?"
  ].join("\n");

}


async function asegurarSesionFirebase() {

  if (auth.currentUser) {
    return auth.currentUser;
  }

  const credencial =
    await signInAnonymously(auth);

  return credencial.user;

}


async function abrirPublicacionCliente(
  id
) {

  $("#vistaGenerador")
    ?.classList.add(
      "hidden"
    );


  $("#vistaRedireccion")
    ?.classList.remove(
      "hidden"
    );


  try {

    await asegurarSesionFirebase();

    const snapshot =
      await getDoc(
        doc(
          db,
          "publicaciones_whatsapp",
          id
        )
      );


    if (!snapshot.exists()) {

      throw new Error(
        "La publicación no existe."
      );

    }


    const publicacion =
      snapshot.data();


    if (
      publicacion.activo === false
    ) {

      throw new Error(
        "Esta publicación ya no está disponible."
      );

    }


    const mensaje =
      construirMensajeWhatsapp({
        id,
        producto:
          publicacion.producto || "",
        precio:
          publicacion.precio || 0,
        vendedor:
          publicacion.vendedor || ""
      });


    const linkWhatsapp =
      `https://wa.me/${WHATSAPP_GENERAL}?text=${encodeURIComponent(mensaje)}`;


    window.location.replace(
      linkWhatsapp
    );


  } catch (error) {

    console.error(error);


    const mensaje =
      $("#mensajeRedireccion");


    if (mensaje) {

      mensaje.textContent =
        error.message ||
        "No se pudo abrir esta publicación.";


      mensaje.classList.add(
        "error"
      );

    }


    $(".spinner")
      ?.classList.add(
        "hidden"
      );

  }

}


async function generarPublicacion() {

  const producto =
    $("#nombreProducto")
      .value
      .trim();


  const precio =
    Number(
      $("#precioProducto")
        .value
    );


  const encargada =
    $("#encargada")
      .value;


  if (!archivoFoto) {

    mostrarEstado(
      "Agrega una foto del producto.",
      true
    );

    return;

  }


  if (!producto) {

    mostrarEstado(
      "Escribe el nombre del producto.",
      true
    );

    return;

  }


  if (
    !Number.isFinite(precio) ||
    precio <= 0
  ) {

    mostrarEstado(
      "Escribe un precio válido.",
      true
    );

    return;

  }


  if (!encargada) {

    mostrarEstado(
      "Selecciona la encargada.",
      true
    );

    return;

  }


  const [
    vendedor,
    encargadaNombre
  ] =
    encargada.split("|");


  const boton =
    $("#btnGenerar");


  try {

    await asegurarSesionFirebase();

    boton.disabled =
      true;


    mostrarEstado(
      "Generando publicación..."
    );


    /*
     * NO guardamos la imagen.
     *
     * Firebase únicamente conserva:
     * producto + precio + vendedor.
     */

    const idCorto =
      await generarIdCortoDisponible();


    await setDoc(
      doc(
        db,
        "publicaciones_whatsapp",
        idCorto
      ),
      {
        producto,
        precio,
        vendedor,
        encargada:
          encargadaNombre,
        activo:
          true,
        fechaCreacion:
          serverTimestamp()
      }
    );


    const link =
      construirLinkCorto(
        idCorto
      );


    publicacionActual = {
      id:
        idCorto,
      producto,
      precio,
      vendedor,
      encargadaNombre,
      link
    };


    $("#resultadoFoto").src =
      fotoLocal;


    $("#resultadoNombre")
      .textContent =
        producto;


    $("#resultadoPrecio")
      .textContent =
        moneda(precio);


    $("#resultadoLink")
      .textContent =
        link;


    $("#resultado")
      .classList.remove(
        "hidden"
      );


    localStorage.setItem(
      "encargadaPublicaciones",
      encargada
    );


    mostrarEstado(
      "Publicación lista para compartir."
    );


  } catch (error) {

    console.error(error);


    mostrarEstado(
      "No se pudo generar la publicación. Revisa los permisos de Firestore.",
      true
    );


  } finally {

    boton.disabled =
      false;

  }

}


async function compartirPublicacion() {

  if (!publicacionActual) {
    return;
  }


  const datos = {

    title:
      publicacionActual.producto,

    text:
      textoPublicacion(
        publicacionActual
      )

  };


  /*
   * La imagen se comparte desde
   * el teléfono, pero NO se guarda
   * en Firebase.
   */

  if (
    archivoFoto &&
    navigator.canShare &&
    navigator.canShare({
      files: [archivoFoto]
    })
  ) {

    datos.files =
      [archivoFoto];

  }


  try {

    if (navigator.share) {

      await navigator.share(
        datos
      );

      return;

    }


    await navigator.clipboard
      .writeText(
        datos.text
      );


    mostrarEstado(
      "Texto copiado. Pégalo en WhatsApp."
    );


  } catch (error) {

    if (
      error?.name !==
      "AbortError"
    ) {

      console.error(error);


      mostrarEstado(
        "No se pudo compartir la publicación.",
        true
      );

    }

  }

}


async function copiarPublicacion() {

  if (!publicacionActual) {
    return;
  }


  await navigator.clipboard
    .writeText(
      textoPublicacion(
        publicacionActual
      )
    );


  mostrarEstado(
    "Publicación copiada."
  );

}


function nuevaPublicacion() {

  $("#foto").value =
    "";


  $("#nombreProducto").value =
    "";


  $("#precioProducto").value =
    "";


  archivoFoto =
    null;


  if (fotoLocal) {

    URL.revokeObjectURL(
      fotoLocal
    );

  }


  fotoLocal =
    "";


  $("#previewFoto")
    .removeAttribute(
      "src"
    );


  $("#previewFoto")
    .style.display =
      "none";


  $("#resultado")
    .classList.add(
      "hidden"
    );


  publicacionActual =
    null;


  mostrarEstado("");


  $("#nombreProducto")
    .focus();

}


function inicializarGenerador() {

  $("#foto")
    ?.addEventListener(
      "change",
      event => {

        archivoFoto =
          event.target.files?.[0] ||
          null;


        if (!archivoFoto) {
          return;
        }


        if (fotoLocal) {

          URL.revokeObjectURL(
            fotoLocal
          );

        }


        fotoLocal =
          URL.createObjectURL(
            archivoFoto
          );


        $("#previewFoto").src =
          fotoLocal;


        $("#previewFoto")
          .style.display =
            "block";

      }
    );


  $("#btnGenerar")
    ?.addEventListener(
      "click",
      generarPublicacion
    );


  $("#btnCompartir")
    ?.addEventListener(
      "click",
      compartirPublicacion
    );


  $("#btnCopiar")
    ?.addEventListener(
      "click",
      copiarPublicacion
    );


  $("#btnNuevo")
    ?.addEventListener(
      "click",
      nuevaPublicacion
    );


  const encargadaGuardada =
    localStorage.getItem(
      "encargadaPublicaciones"
    );


  if (encargadaGuardada) {

    const existe =
      [...$("#encargada").options]
        .some(
          option =>
            option.value ===
            encargadaGuardada
        );


    if (existe) {

      $("#encargada").value =
        encargadaGuardada;

    }

  }

}


const parametros =
  new URLSearchParams(
    window.location.search
  );


const publicacionId =
  parametros.get("p");


if (publicacionId) {

  abrirPublicacionCliente(
    publicacionId
  );

} else {

  inicializarGenerador();

}
