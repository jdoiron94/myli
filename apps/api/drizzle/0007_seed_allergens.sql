-- The fixed allergen tags (spec §3.2), the same list as ALLERGENS in packages/shared/src/tags.ts.
-- They're never edited; changing the list takes a new migration (a test compares the two).
INSERT INTO `tag` (`type`, `name`, `name_key`, `created_at`, `updated_at`) VALUES
	('allergen', 'milk', 'milk', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('allergen', 'eggs', 'eggs', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('allergen', 'fish', 'fish', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('allergen', 'shellfish', 'shellfish', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('allergen', 'tree nuts', 'tree nuts', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('allergen', 'peanuts', 'peanuts', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('allergen', 'wheat', 'wheat', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('allergen', 'soy', 'soy', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('allergen', 'sesame', 'sesame', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
