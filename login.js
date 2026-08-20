import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const $ = selector => document.querySelector(selector);

function mostrarError(mensaje = "") {
  $("#loginError").textContent = mensaje;
  $("#loginError").classList.toggle("hidden", !mensaje);
}

const errorPerfil = sessionStorage.getItem("loginError");
if (errorPerfil) {
  mostrarError(errorPerfil);
  sessionStorage.removeItem("loginError");
}

onAuthStateChanged(auth, user => {
  if (user) window.location.replace("index.html");
});

$("#btnMostrarContrasena").addEventListener("click", () => {
  const campo = $("#loginContrasena");
  const visible = campo.type === "text";
  campo.type = visible ? "password" : "text";
  $("#btnMostrarContrasena").textContent = visible ? "Ver" : "Ocultar";
  $("#btnMostrarContrasena").setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
});

$("#formLogin").addEventListener("submit", async event => {
  event.preventDefault();
  mostrarError("");

  const correo = $("#loginCorreo").value.trim();
  const contrasena = $("#loginContrasena").value;
  const boton = $("#btnIniciarSesion");

  if (!correo || !contrasena) {
    mostrarError("Completa el correo y la contraseña.");
    return;
  }

  boton.disabled = true;
  boton.querySelector("span").textContent = "Ingresando…";

  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithEmailAndPassword(auth, correo, contrasena);
    window.location.replace("index.html");
  } catch (error) {
    console.error(error);
    const mensajes = {
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/invalid-email": "El correo electrónico no es válido.",
      "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
      "auth/network-request-failed": "No se pudo conectar. Revisa tu internet."
    };
    mostrarError(mensajes[error.code] || "No se pudo iniciar sesión.");
  } finally {
    boton.disabled = false;
    boton.querySelector("span").textContent = "Iniciar sesión";
  }
});
