let audioCtx = null

/**
 * Bip synthétique (Web Audio, pas de fichier son à héberger). Créé une
 * seule fois puis réutilisé — recréer un `AudioContext` à chaque bip finit
 * par se faire bloquer par le navigateur (limite du nombre de contextes).
 */
function getContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    audioCtx = new Ctx()
  }
  return audioCtx
}

/**
 * Débloque l'audio dès la première interaction réelle de l'utilisateur
 * (tap/clic) — les navigateurs (surtout mobile) refusent de démarrer un
 * `AudioContext` avant un geste utilisateur. Sans ça, le tout premier bip
 * après le chargement de la page risquerait de rester silencieux.
 */
export function amorcerAudio() {
  try {
    const ctx = getContext()
    if (ctx.state === 'suspended') ctx.resume()
  } catch {
    // Web Audio indisponible — tant pis, `jouerBip` échoue silencieusement.
  }
}

export function jouerBip({ frequence = 880, dureeMs = 180, volume = 0.2 } = {}) {
  try {
    const ctx = getContext()
    if (ctx.state === 'suspended') ctx.resume()
    const oscillateur = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillateur.type = 'sine'
    oscillateur.frequency.value = frequence
    gain.gain.value = volume
    oscillateur.connect(gain)
    gain.connect(ctx.destination)
    oscillateur.start()
    oscillateur.stop(ctx.currentTime + dureeMs / 1000)
  } catch {
    // Audio non disponible (contexte pas encore débloqué, navigateur...) — non bloquant.
  }
}

/** Deux bips ascendants — réservé aux événements les plus importants (nouveau ticket, appel serveur, commande servie). */
export function jouerDoubleBip() {
  jouerBip({ frequence: 880, dureeMs: 150 })
  setTimeout(() => jouerBip({ frequence: 1046, dureeMs: 200 }), 180)
}
