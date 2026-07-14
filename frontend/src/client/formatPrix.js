export function formatPrix(montant, devise) {
  const nombre = Number(montant).toLocaleString('fr-FR')
  return devise === 'XOF' ? `${nombre} F` : `${nombre} ${devise}`
}
