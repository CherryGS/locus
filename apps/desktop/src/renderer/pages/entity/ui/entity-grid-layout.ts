export const entityGridLayout = {
  cardWidth: 240,
  maximumCardWidth: 320,
  cardHeight: 216,
  gap: 12,
  horizontalInset: 16,
  verticalInset: 16,
} as const

export const minimumEntityGridWidth = entityGridLayout.cardWidth + 2 * entityGridLayout.horizontalInset
