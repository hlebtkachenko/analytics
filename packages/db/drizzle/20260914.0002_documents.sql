-- Documents register, per kind content, derived economic events, and the shared Czech chart of accounts.
-- BAP is not the book of record: no numbering series, no period close, no legal immutability lives here.
-- Organization stays the only row level security boundary; the legal entity is pinned by composite foreign keys.

-- Shared reference data, identical for every tenant, so it carries no organization_id and no row level security.
CREATE TABLE IF NOT EXISTS app.directive_account (
  code char(3) PRIMARY KEY,
  -- Denormalized first two digits: group reports read it without substring expressions on every row.
  group_code char(2) NOT NULL,
  class smallint NOT NULL,
  name_cs text NOT NULL,
  name_en text NOT NULL,
  -- Decides the sign a report gives an account, so a derivation rule never has to hardcode it.
  nature text NOT NULL,
  CONSTRAINT directive_account_code_check CHECK (code ~ '^[0-9]{3}$'),
  CONSTRAINT directive_account_class_check CHECK (class BETWEEN 0 AND 9),
  CONSTRAINT directive_account_nature_check
    CHECK (nature IN ('ASSET', 'LIABILITY', 'EQUITY', 'EXPENSE', 'REVENUE', 'CLOSING', 'OFF_BALANCE'))
);

-- Seed of the entrepreneur chart of accounts from decree 500/2002 Sb., appendix 1.
-- Classes 8 and 9 are entity defined internal accounts, so the decree fixes no synthetic codes for them.
-- Group 75 to 79 is entity specific in the same way and therefore produces no rows either.
INSERT INTO app.directive_account (code, group_code, class, name_cs, name_en, nature) VALUES
  ('011', '01', 0, 'Zřizovací výdaje', 'Formation Costs', 'ASSET'),
  ('012', '01', 0, 'Nehmotné výsledky výzkumu a vývoje', 'R&D Intangibles', 'ASSET'),
  ('013', '01', 0, 'Software', 'Software', 'ASSET'),
  ('014', '01', 0, 'Ocenitelná práva', 'Valuable Rights', 'ASSET'),
  ('015', '01', 0, 'Goodwill', 'Goodwill', 'ASSET'),
  ('019', '01', 0, 'Jiný dlouhodobý nehmotný majetek', 'Other Long-term Intangible Assets', 'ASSET'),
  ('021', '02', 0, 'Stavby', 'Buildings and Structures', 'ASSET'),
  ('022', '02', 0, 'Samostatné hmotné movité věci a soubory hmotných movitých věcí', 'Tangible Movable Assets - individual items and sets', 'ASSET'),
  ('025', '02', 0, 'Pěstitelské celky trvalých porostů', 'Perennial Cultivated Plantations', 'ASSET'),
  ('026', '02', 0, 'Dospělá zvířata a jejich skupiny', 'Mature Animals', 'ASSET'),
  ('029', '02', 0, 'Jiný dlouhodobý hmotný majetek', 'Other Depreciable Tangible Assets', 'ASSET'),
  ('031', '03', 0, 'Pozemky', 'Land', 'ASSET'),
  ('032', '03', 0, 'Umělecká díla a sbírky', 'Works of Art and Collections', 'ASSET'),
  ('041', '04', 0, 'Pořízení dlouhodobého nehmotného majetku', 'DNM Acquisition in Progress', 'ASSET'),
  ('042', '04', 0, 'Pořízení dlouhodobého hmotného majetku', 'DHM Acquisition in Progress', 'ASSET'),
  ('043', '04', 0, 'Pořízení dlouhodobého finančního majetku', 'Financial Asset Acquisition in Progress', 'ASSET'),
  ('051', '05', 0, 'Poskytnuté zálohy na DNM', 'Advances for Intangible Assets', 'ASSET'),
  ('052', '05', 0, 'Poskytnuté zálohy na DHM', 'Advances for Tangible Assets', 'ASSET'),
  ('053', '05', 0, 'Poskytnuté zálohy na finanční majetek', 'Advances for Financial Assets', 'ASSET'),
  ('061', '06', 0, 'Podíly - ovládaná nebo ovládající osoba', 'Equity Stakes - Controlled/Controlling', 'ASSET'),
  ('062', '06', 0, 'Podíly - podstatný vliv', 'Equity Stakes - Significant Influence', 'ASSET'),
  ('063', '06', 0, 'Ostatní dlouhodobé cenné papíry a podíly', 'Other Long-term Securities', 'ASSET'),
  ('065', '06', 0, 'Dluhové cenné papíry držené do splatnosti', 'Debt Securities Held to Maturity', 'ASSET'),
  ('066', '06', 0, 'Půjčky a úvěry - ovládaná nebo ovládající osoba', 'Loans to/from Controlled Entity', 'ASSET'),
  ('067', '06', 0, 'Půjčky a úvěry - podstatný vliv', 'Loans to/from Associates', 'ASSET'),
  ('069', '06', 0, 'Jiný dlouhodobý finanční majetek', 'Other Long-term Financial Assets', 'ASSET'),
  ('071', '07', 0, 'Oprávky k zřizovacím výdajům', 'Accumulated Amort. - Formation Costs', 'ASSET'),
  ('072', '07', 0, 'Oprávky k nehmotným výsledkům VaV', 'Accumulated Amort. - R&D', 'ASSET'),
  ('073', '07', 0, 'Oprávky k softwaru', 'Accumulated Amort. - Software', 'ASSET'),
  ('074', '07', 0, 'Oprávky k ocenitelným právům', 'Accumulated Amort. - Valuable Rights', 'ASSET'),
  ('075', '07', 0, 'Oprávky ke goodwillu', 'Accumulated Amort. - Goodwill', 'ASSET'),
  ('079', '07', 0, 'Oprávky k jinému DNM', 'Accumulated Amort. - Other DNM', 'ASSET'),
  ('081', '08', 0, 'Oprávky ke stavbám', 'Accumulated Depr. - Buildings', 'ASSET'),
  ('082', '08', 0, 'Oprávky k hmotným movitým věcem', 'Accumulated Depr. - Movables', 'ASSET'),
  ('085', '08', 0, 'Oprávky k pěstitelským celkům', 'Accumulated Depr. - Plantations', 'ASSET'),
  ('086', '08', 0, 'Oprávky k dospělým zvířatům', 'Accumulated Depr. - Animals', 'ASSET'),
  ('089', '08', 0, 'Oprávky k jinému DHM', 'Accumulated Depr. - Other DHM', 'ASSET'),
  ('091', '09', 0, 'Opravná položka k DNM', 'Impairment - DNM', 'ASSET'),
  ('092', '09', 0, 'Opravná položka k DHM', 'Impairment - DHM', 'ASSET'),
  ('093', '09', 0, 'Opravná položka k nedokončenému DNM', 'Impairment - DNM in Progress', 'ASSET'),
  ('094', '09', 0, 'Opravná položka k nedokončenému DHM', 'Impairment - DHM in Progress', 'ASSET'),
  ('095', '09', 0, 'Opravná položka k poskytnutým zálohám', 'Impairment - Advances for LT Assets', 'ASSET'),
  ('096', '09', 0, 'Opravná položka k finančnímu majetku', 'Impairment - Financial Assets', 'ASSET'),
  ('111', '11', 1, 'Pořízení materiálu', 'Material Acquisition (Method A accumulator)', 'ASSET'),
  ('112', '11', 1, 'Materiál na skladě', 'Material in Warehouse', 'ASSET'),
  ('119', '11', 1, 'Materiál na cestě', 'Material in Transit', 'ASSET'),
  ('121', '12', 1, 'Nedokončená výroba', 'Work in Progress', 'ASSET'),
  ('122', '12', 1, 'Polotovary vlastní výroby', 'Semi-finished Products', 'ASSET'),
  ('123', '12', 1, 'Výrobky', 'Finished Goods', 'ASSET'),
  ('124', '12', 1, 'Mladá a ostatní zvířata', 'Young and Other Animals', 'ASSET'),
  ('131', '13', 1, 'Pořízení zboží', 'Goods Acquisition (Method A accumulator)', 'ASSET'),
  ('132', '13', 1, 'Zboží na skladě a v prodejnách', 'Goods in Warehouse and Shops', 'ASSET'),
  ('139', '13', 1, 'Zboží na cestě', 'Goods in Transit', 'ASSET'),
  ('151', '15', 1, 'Poskytnuté zálohy na materiál', 'Advances for Materials', 'ASSET'),
  ('152', '15', 1, 'Poskytnuté zálohy na zboží', 'Advances for Goods', 'ASSET'),
  ('191', '19', 1, 'Opravná položka k materiálu', 'Impairment - Material', 'ASSET'),
  ('192', '19', 1, 'Opravná položka k nedokončené výrobě', 'Impairment - WIP', 'ASSET'),
  ('193', '19', 1, 'Opravná položka k polotovarům', 'Impairment - Semi-finished', 'ASSET'),
  ('194', '19', 1, 'Opravná položka k výrobkům', 'Impairment - Finished Goods', 'ASSET'),
  ('195', '19', 1, 'Opravná položka k mladým zvířatům', 'Impairment - Young Animals', 'ASSET'),
  ('196', '19', 1, 'Opravná položka ke zboží', 'Impairment - Goods', 'ASSET'),
  ('211', '21', 2, 'Pokladna', 'Cash Till', 'ASSET'),
  ('213', '21', 2, 'Ceniny', 'Stamps and Vouchers', 'ASSET'),
  ('221', '22', 2, 'Bankovní účty', 'Bank Accounts', 'ASSET'),
  ('231', '23', 2, 'Krátkodobé bankovní úvěry', 'Short-term Bank Loans', 'ASSET'),
  ('232', '23', 2, 'Eskontní úvěry', 'Discounted Bills Credit', 'ASSET'),
  ('241', '24', 2, 'Emitované krátkodobé dluhopisy', 'Issued Short-term Bonds', 'ASSET'),
  ('249', '24', 2, 'Ostatní krátkodobé finanční výpomoci', 'Other Short-term Assistance', 'ASSET'),
  ('251', '25', 2, 'Majetkové cenné papíry k obchodování', 'Equity Securities Held for Trading', 'ASSET'),
  ('252', '25', 2, 'Vlastní akcie a obchodní podíly', 'Own Shares and Stakes', 'ASSET'),
  ('253', '25', 2, 'Dluhové cenné papíry k obchodování', 'Debt Securities Held for Trading', 'ASSET'),
  ('255', '25', 2, 'Vlastní dluhopisy', 'Own Bonds Repurchased', 'ASSET'),
  ('256', '25', 2, 'Dluhové CP do 1 roku držené do splatnosti', 'Short-term Debt Securities HTM', 'ASSET'),
  ('257', '25', 2, 'Ostatní realizovatelné cenné papíry', 'Other Available-for-sale Securities', 'ASSET'),
  ('259', '25', 2, 'Pořízení krátkodobého finančního majetku', 'ST Financial Asset Acquisition', 'ASSET'),
  ('261', '26', 2, 'Peníze na cestě', 'Cash in Transit', 'ASSET'),
  ('291', '29', 2, 'Opravná položka ke krátkodobému fin. majetku', 'Impairment - ST Financial Assets', 'ASSET'),
  ('311', '31', 3, 'Pohledávky z obchodních vztahů', 'Trade Receivables', 'ASSET'),
  ('312', '31', 3, 'Směnky k inkasu', 'Bills of Exchange Receivable', 'ASSET'),
  ('313', '31', 3, 'Pohledávky za eskontované CP', 'Receivables for Discounted Securities', 'ASSET'),
  ('314', '31', 3, 'Poskytnuté zálohy', 'Advances Paid', 'ASSET'),
  ('315', '31', 3, 'Ostatní pohledávky', 'Other Receivables', 'ASSET'),
  ('321', '32', 3, 'Závazky z obchodních vztahů', 'Trade Payables', 'LIABILITY'),
  ('322', '32', 3, 'Směnky k úhradě', 'Bills of Exchange Payable', 'LIABILITY'),
  ('324', '32', 3, 'Přijaté zálohy', 'Advances Received', 'LIABILITY'),
  ('325', '32', 3, 'Ostatní závazky', 'Other Payables', 'LIABILITY'),
  ('331', '33', 3, 'Zaměstnanci - mzdové závazky', 'Employee Wage Payables', 'LIABILITY'),
  ('333', '33', 3, 'Ostatní závazky vůči zaměstnancům', 'Other Employee Payables', 'LIABILITY'),
  ('335', '33', 3, 'Pohledávky za zaměstnanci', 'Receivables from Employees', 'ASSET'),
  ('336', '33', 3, 'Zúčtování s institucemi SP a ZP', 'Social + Health Insurance Settlements', 'LIABILITY'),
  ('341', '34', 3, 'Daň z příjmů', 'Income Tax Payable/Receivable', 'LIABILITY'),
  ('342', '34', 3, 'Ostatní přímé daně', 'Other Direct Taxes (withholding)', 'LIABILITY'),
  ('343', '34', 3, 'Daň z přidané hodnoty', 'VAT (DPH)', 'LIABILITY'),
  ('344', '34', 3, 'Daň silniční', 'Road Tax', 'LIABILITY'),
  ('345', '34', 3, 'Ostatní daně a poplatky', 'Other Taxes and Fees', 'LIABILITY'),
  ('346', '34', 3, 'Dotace ze státního rozpočtu', 'State Budget Subsidies', 'LIABILITY'),
  ('347', '34', 3, 'Ostatní dotace', 'Other Subsidies', 'LIABILITY'),
  ('351', '35', 3, 'Pohledávky za ovládanými osobami', 'Receivables from Subsidiaries', 'ASSET'),
  ('353', '35', 3, 'Pohledávky za účastníky sdružení', 'Receivables from Consortium Members', 'ASSET'),
  ('354', '35', 3, 'Pohledávky za společníky - úhrada ztráty', 'Partner Loss Coverage Receivable', 'ASSET'),
  ('355', '35', 3, 'Ostatní pohledávky za společníky', 'Other Partner Receivables', 'ASSET'),
  ('361', '36', 3, 'Závazky k ovládaným osobám', 'Payables to Subsidiaries', 'LIABILITY'),
  ('364', '36', 3, 'Závazky - rozdělení zisku (dividendy)', 'Dividend Payables', 'LIABILITY'),
  ('365', '36', 3, 'Ostatní závazky ke společníkům', 'Other Partner Payables', 'LIABILITY'),
  ('373', '37', 3, 'Pohledávky a závazky z pevných operací', 'Forward Contract Positions', 'ASSET'),
  ('378', '37', 3, 'Jiné pohledávky', 'Other Receivables', 'ASSET'),
  ('379', '37', 3, 'Jiné závazky', 'Other Payables', 'LIABILITY'),
  ('381', '38', 3, 'Náklady příštích období', 'Prepaid Expenses', 'ASSET'),
  ('382', '38', 3, 'Komplexní náklady příštích období', 'Complex Prepaid Expenses', 'ASSET'),
  ('383', '38', 3, 'Výdaje příštích období', 'Accrued Expenses', 'LIABILITY'),
  ('384', '38', 3, 'Výnosy příštích období', 'Deferred Revenue', 'LIABILITY'),
  ('385', '38', 3, 'Příjmy příštích období', 'Accrued Revenue', 'ASSET'),
  ('388', '38', 3, 'Dohadné účty aktivní', 'Estimated Receivables', 'ASSET'),
  ('389', '38', 3, 'Dohadné účty pasivní', 'Estimated Payables / Accrued Liabilities', 'LIABILITY'),
  ('391', '39', 3, 'Opravná položka k pohledávkám', 'Receivable Impairment Allowance', 'ASSET'),
  ('395', '39', 3, 'Vnitřní zúčtování', 'Internal Clearing', 'ASSET'),
  ('398', '39', 3, 'Spojovací účet při sdružení', 'Consortium Linking Account', 'ASSET'),
  ('411', '41', 4, 'Základní kapitál', 'Registered / Share Capital', 'EQUITY'),
  ('412', '41', 4, 'Emisní ážio', 'Share Premium', 'EQUITY'),
  ('413', '41', 4, 'Ostatní kapitálové fondy', 'Other Capital Funds', 'EQUITY'),
  ('414', '41', 4, 'Oceňovací rozdíly z přecenění majetku', 'Revaluation Differences', 'EQUITY'),
  ('418', '41', 4, 'Oceňovací rozdíly z přeměn', 'Revaluation Differences - Transformations', 'EQUITY'),
  ('419', '41', 4, 'Změny základního kapitálu', 'Capital Changes in Progress', 'EQUITY'),
  ('421', '42', 4, 'Rezervní fond', 'Legal Reserve Fund', 'EQUITY'),
  ('422', '42', 4, 'Nedělitelný fond', 'Indivisible Fund (Cooperatives)', 'EQUITY'),
  ('423', '42', 4, 'Statutární fondy', 'Statutory Funds', 'EQUITY'),
  ('427', '42', 4, 'Ostatní fondy', 'Other Voluntary Funds', 'EQUITY'),
  ('428', '42', 4, 'Nerozdělený zisk minulých let', 'Retained Earnings - Prior Years', 'EQUITY'),
  ('429', '42', 4, 'Neuhrazená ztráta minulých let', 'Accumulated Losses - Prior Years', 'EQUITY'),
  ('431', '43', 4, 'Výsledek hospodaření ve schvalovacím řízení', 'Result Awaiting Approval', 'EQUITY'),
  ('451', '45', 4, 'Zákonné rezervy', 'Statutory Provisions (Tax-deductible)', 'LIABILITY'),
  ('453', '45', 4, 'Rezerva na daň z příjmů', 'Income Tax Provision', 'LIABILITY'),
  ('459', '45', 4, 'Ostatní rezervy', 'Other Provisions (Accounting)', 'LIABILITY'),
  ('461', '46', 4, 'Dlouhodobé bankovní úvěry', 'Long-term Bank Loans', 'LIABILITY'),
  ('471', '47', 4, 'Závazky k ovládaným osobám', 'LT Payables to Subsidiaries', 'LIABILITY'),
  ('473', '47', 4, 'Emitované dluhopisy', 'Bonds Issued (Long-term)', 'LIABILITY'),
  ('474', '47', 4, 'Závazky z pronájmu', 'Lease Obligations', 'LIABILITY'),
  ('475', '47', 4, 'Dlouhodobé přijaté zálohy', 'Long-term Advances Received', 'LIABILITY'),
  ('479', '47', 4, 'Ostatní dlouhodobé závazky', 'Other Long-term Payables', 'LIABILITY'),
  ('481', '48', 4, 'Odložený daňový závazek a pohledávka', 'Deferred Tax Liability / Asset', 'LIABILITY'),
  ('491', '49', 4, 'Účet individuálního podnikatele', 'Sole Trader Capital Account', 'EQUITY'),
  ('501', '50', 5, 'Spotřeba materiálu', 'Material Consumption', 'EXPENSE'),
  ('502', '50', 5, 'Spotřeba energie', 'Energy Consumption', 'EXPENSE'),
  ('503', '50', 5, 'Spotřeba ostatních neskladovatelných dodávek', 'Other Non-storable Consumables', 'EXPENSE'),
  ('504', '50', 5, 'Prodané zboží', 'Cost of Goods Sold', 'EXPENSE'),
  ('511', '51', 5, 'Opravy a udržování', 'Repairs and Maintenance', 'EXPENSE'),
  ('512', '51', 5, 'Cestovné', 'Travel Expenses', 'EXPENSE'),
  ('513', '51', 5, 'Náklady na reprezentaci', 'Entertainment (non-deductible)', 'EXPENSE'),
  ('518', '51', 5, 'Ostatní služby', 'Other Services', 'EXPENSE'),
  ('521', '52', 5, 'Mzdové náklady', 'Wage Costs', 'EXPENSE'),
  ('522', '52', 5, 'Příjmy společníků ze závislé činnosti', 'Partner Employment Income', 'EXPENSE'),
  ('523', '52', 5, 'Odměny členům orgánů', 'Board/Supervisory Board Fees', 'EXPENSE'),
  ('524', '52', 5, 'Zákonné sociální pojištění (zaměstnavatel)', 'Employer Social + Health Insurance', 'EXPENSE'),
  ('525', '52', 5, 'Ostatní sociální pojištění', 'Voluntary Supplementary Insurance', 'EXPENSE'),
  ('526', '52', 5, 'Sociální náklady individuálního podnikatele', 'Sole Proprietor Social Costs', 'EXPENSE'),
  ('527', '52', 5, 'Zákonné sociální náklady', 'Statutory Employee Benefits', 'EXPENSE'),
  ('528', '52', 5, 'Ostatní sociální náklady', 'Voluntary Employee Benefits', 'EXPENSE'),
  ('531', '53', 5, 'Daň silniční', 'Road Tax', 'EXPENSE'),
  ('532', '53', 5, 'Daň z nemovitých věcí', 'Real Property Tax', 'EXPENSE'),
  ('538', '53', 5, 'Ostatní daně a poplatky', 'Other Taxes and Fees', 'EXPENSE'),
  ('541', '54', 5, 'ZC prodaného dlouhodobého majetku', 'NBV of Disposed LT Assets', 'EXPENSE'),
  ('542', '54', 5, 'Prodaný materiál', 'Cost of Sold Material', 'EXPENSE'),
  ('543', '54', 5, 'Dary', 'Charitable Gifts (partly non-deductible)', 'EXPENSE'),
  ('544', '54', 5, 'Smluvní pokuty a úroky z prodlení', 'Contractual Penalties Paid', 'EXPENSE'),
  ('545', '54', 5, 'Ostatní pokuty a penále', 'Other Fines (non-deductible)', 'EXPENSE'),
  ('546', '54', 5, 'Odpis pohledávky', 'Receivable Write-off', 'EXPENSE'),
  ('548', '54', 5, 'Ostatní provozní náklady', 'Other Operating Expenses', 'EXPENSE'),
  ('549', '54', 5, 'Manka a škody provozní', 'Operational Shortages and Losses', 'EXPENSE'),
  ('551', '55', 5, 'Odpisy DNM a DHM', 'Depreciation and Amortization', 'EXPENSE'),
  ('552', '55', 5, 'Tvorba zákonných rezerv', 'Statutory Provision Creation', 'EXPENSE'),
  ('554', '55', 5, 'Tvorba ostatních rezerv', 'Other Provision Creation', 'EXPENSE'),
  ('558', '55', 5, 'Tvorba zákonných opravných položek', 'Statutory Receivable Allowances', 'EXPENSE'),
  ('559', '55', 5, 'Tvorba ostatních opravných položek', 'Other Impairment Allowances', 'EXPENSE'),
  ('561', '56', 5, 'Prodané cenné papíry a podíly', 'Cost of Securities Sold', 'EXPENSE'),
  ('562', '56', 5, 'Úroky', 'Interest Expense', 'EXPENSE'),
  ('563', '56', 5, 'Kurzové ztráty', 'FX Losses', 'EXPENSE'),
  ('564', '56', 5, 'Náklady z přecenění CP', 'FV Losses - Securities', 'EXPENSE'),
  ('566', '56', 5, 'Náklady z finančního majetku', 'Financial Asset Losses', 'EXPENSE'),
  ('567', '56', 5, 'Náklady z derivátů', 'Derivative Losses', 'EXPENSE'),
  ('568', '56', 5, 'Ostatní finanční náklady', 'Other Financial Expenses', 'EXPENSE'),
  ('569', '56', 5, 'Manka a škody na finančním majetku', 'Financial Asset Shortages', 'EXPENSE'),
  ('574', '57', 5, 'Tvorba finančních rezerv', 'Financial Provision Creation', 'EXPENSE'),
  ('579', '57', 5, 'Tvorba opravných položek - finanční', 'Financial Impairment Allowances', 'EXPENSE'),
  ('591', '59', 5, 'Daň z příjmů splatná', 'Current Income Tax Expense', 'EXPENSE'),
  ('592', '59', 5, 'Daň z příjmů odložená', 'Deferred Tax Expense', 'EXPENSE'),
  ('595', '59', 5, 'Dodatečné odvody daně', 'Additional Tax Charges', 'EXPENSE'),
  ('596', '59', 5, 'Převod podílu na výsledku hospodaření', 'Result Share Transfer to Partners', 'EXPENSE'),
  ('597', '59', 5, 'Převod provozních nákladů', 'Transfer of Operating Expenses', 'EXPENSE'),
  ('598', '59', 5, 'Převod finančních nákladů', 'Transfer of Financial Expenses', 'EXPENSE'),
  ('601', '60', 6, 'Tržby za vlastní výrobky', 'Revenue from Own Products', 'REVENUE'),
  ('602', '60', 6, 'Tržby z prodeje služeb', 'Service Revenue', 'REVENUE'),
  ('604', '60', 6, 'Tržby za prodané zboží', 'Revenue from Goods Sold', 'REVENUE'),
  ('611', '61', 6, 'Změna stavu nedokončené výroby', 'Change in WIP', 'REVENUE'),
  ('612', '61', 6, 'Změna stavu polotovarů', 'Change in Semi-finished', 'REVENUE'),
  ('613', '61', 6, 'Změna stavu výrobků', 'Change in Finished Goods', 'REVENUE'),
  ('614', '61', 6, 'Změna stavu zvířat', 'Change in Animal State', 'REVENUE'),
  ('621', '62', 6, 'Aktivace materiálu a zboží', 'Capitalization of Material/Goods', 'REVENUE'),
  ('622', '62', 6, 'Aktivace vnitropodnikových služeb', 'Capitalization of Internal Services', 'REVENUE'),
  ('623', '62', 6, 'Aktivace DNM', 'Capitalization of Created DNM', 'REVENUE'),
  ('624', '62', 6, 'Aktivace DHM', 'Capitalization of Created DHM', 'REVENUE'),
  ('641', '64', 6, 'Tržby z prodeje DHM', 'Revenue from Asset Sales', 'REVENUE'),
  ('642', '64', 6, 'Tržby z prodeje materiálu', 'Revenue from Material Sales', 'REVENUE'),
  ('644', '64', 6, 'Smluvní pokuty - přijaté', 'Contractual Penalties Received', 'REVENUE'),
  ('646', '64', 6, 'Výnosy z odepsaných pohledávek', 'Recovered Written-off Receivables', 'REVENUE'),
  ('648', '64', 6, 'Ostatní provozní výnosy', 'Other Operating Revenue', 'REVENUE'),
  ('661', '66', 6, 'Tržby z prodeje CP a podílů', 'Revenue from Securities Sold', 'REVENUE'),
  ('662', '66', 6, 'Úroky', 'Interest Income', 'REVENUE'),
  ('663', '66', 6, 'Kurzové zisky', 'FX Gains', 'REVENUE'),
  ('664', '66', 6, 'Výnosy z přecenění CP a derivátů', 'FV Gains - Securities and Derivatives', 'REVENUE'),
  ('665', '66', 6, 'Výnosy z dlouhodobého fin. majetku', 'Income from LT Financial Assets (Dividends)', 'REVENUE'),
  ('666', '66', 6, 'Výnosy z krátkodobého fin. majetku', 'Income from ST Financial Assets', 'REVENUE'),
  ('667', '66', 6, 'Výnosy z derivátových operací', 'Derivative Gains', 'REVENUE'),
  ('668', '66', 6, 'Ostatní finanční výnosy', 'Other Financial Revenue', 'REVENUE'),
  ('697', '69', 6, 'Převod provozních výnosů', 'Transfer of Operating Revenue', 'REVENUE'),
  ('698', '69', 6, 'Převod finančních výnosů', 'Transfer of Financial Revenue', 'REVENUE'),
  ('701', '70', 7, 'Počáteční účet rozvažný', 'Opening Balance Sheet Account', 'CLOSING'),
  ('702', '70', 7, 'Konečný účet rozvažný', 'Closing Balance Sheet Account', 'CLOSING'),
  ('710', '71', 7, 'Účet zisků a ztrát', 'Profit and Loss Account', 'CLOSING')
ON CONFLICT (code) DO NOTHING;

-- Lets app.document pin an upload's organization_id to its own, the same way datasets already pin theirs.
ALTER TABLE app.upload
  ADD CONSTRAINT upload_id_organization_key UNIQUE (id, organization_id);

-- Partners are organization wide on purpose: the same supplier invoices several of our legal entities.
CREATE TABLE IF NOT EXISTS app.partner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name text NOT NULL,
  registration_number text,
  vat_number text,
  country_code char(2),
  -- Set when the partner is one of our own entities, which is what makes an intercompany document detectable.
  legal_entity_id uuid,
  -- No foreign key to auth."user": app tables stay decoupled from the identity schema.
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_name_check CHECK (length(name) BETWEEN 1 AND 200),
  -- The same bounds and alphabets the API validates, so a bypassed boundary still cannot store free text.
  CONSTRAINT partner_registration_number_check
    CHECK (registration_number IS NULL OR registration_number ~ '^[A-Za-z0-9-]{1,32}$'),
  CONSTRAINT partner_vat_number_check
    CHECK (vat_number IS NULL OR vat_number ~ '^[A-Z]{2}[A-Za-z0-9]{2,16}$'),
  CONSTRAINT partner_country_code_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  -- Lets attached tables carry a composite foreign key that pins their organization_id to this row's.
  CONSTRAINT partner_id_organization_key UNIQUE (id, organization_id),
  -- Deleting our own entity keeps the partner as an ordinary third party rather than destroying its documents.
  CONSTRAINT partner_legal_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE SET NULL (legal_entity_id)
);

-- Partial, because an unidentified partner has no registration number and several of them must coexist.
CREATE UNIQUE INDEX IF NOT EXISTS partner_registration_number_key
  ON app.partner(organization_id, registration_number)
  WHERE registration_number IS NOT NULL;

-- Lowercased name: the picker orders by it, so the ordering is index driven. A contains search still scans, because a leading wildcard cannot use a b-tree.
CREATE INDEX IF NOT EXISTS partner_organization_name_idx ON app.partner(organization_id, lower(name));

-- One uniform register for every kind: structured content lives in per kind tables, everything else in attributes.
CREATE TABLE IF NOT EXISTS app.document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  legal_entity_id uuid NOT NULL,
  -- Closed vocabulary: a new kind is a product decision, so it takes a migration.
  kind text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  upload_id uuid,
  -- The number the issuer printed, never a number BAP invents: the platform runs no series.
  reference text,
  title text NOT NULL,
  partner_id uuid,
  document_date date NOT NULL,
  valid_from date,
  valid_to date,
  currency_code char(3) NOT NULL DEFAULT 'CZK',
  -- Nullable because a contract or an HR paper has no amount; invoice kinds get it from their computed gross total.
  total_amount numeric(19, 4),
  status text NOT NULL DEFAULT 'registered',
  version integer NOT NULL DEFAULT 1,
  supersedes_document_id uuid,
  -- A correction registers a new row and clears this flag on the old one, so history stays readable.
  is_current boolean NOT NULL DEFAULT true,
  content_hash text,
  notes text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_kind_check CHECK (kind IN (
    'issued_invoice', 'received_invoice', 'credit_note', 'receipt', 'bank_statement',
    'contract', 'agreement', 'hr_document', 'payroll', 'tax_filing', 'other'
  )),
  CONSTRAINT document_source_check CHECK (source IN ('manual', 'upload', 'import', 'api')),
  CONSTRAINT document_reference_check CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 64),
  CONSTRAINT document_title_check CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT document_currency_code_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT document_status_check CHECK (status IN ('registered', 'needs_review', 'verified', 'archived')),
  CONSTRAINT document_version_check CHECK (version >= 1),
  CONSTRAINT document_content_hash_check CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_notes_check CHECK (notes IS NULL OR length(notes) <= 2000),
  CONSTRAINT document_validity_check
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  -- Lets attached tables carry a composite foreign key that pins their organization_id to this row's.
  CONSTRAINT document_id_organization_key UNIQUE (id, organization_id),
  -- Composite foreign key makes the denormalized organization_id provably equal to the entity's.
  CONSTRAINT document_legal_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE,
  -- The register survives a deleted partner or upload, because the paper itself still exists.
  CONSTRAINT document_partner_fkey FOREIGN KEY (partner_id, organization_id)
    REFERENCES app.partner(id, organization_id) ON DELETE SET NULL (partner_id),
  CONSTRAINT document_upload_fkey FOREIGN KEY (upload_id, organization_id)
    REFERENCES app.upload(id, organization_id) ON DELETE SET NULL (upload_id),
  CONSTRAINT document_supersedes_fkey FOREIGN KEY (supersedes_document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE SET NULL (supersedes_document_id)
);

-- Partial on is_current: a superseded version keeps its old reference, so only the live row claims it.
CREATE UNIQUE INDEX IF NOT EXISTS document_current_reference_key
  ON app.document(legal_entity_id, kind, reference)
  WHERE reference IS NOT NULL AND is_current;

-- The list page orders by document_date descending with id as the tiebreaker, so the index carries both.
CREATE INDEX IF NOT EXISTS document_list_idx
  ON app.document(organization_id, legal_entity_id, document_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS document_partner_idx
  ON app.document(organization_id, partner_id)
  WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_status_idx ON app.document(organization_id, status);

-- Both are self references cleared by ON DELETE SET NULL, and a version chain is walked by them.
CREATE INDEX IF NOT EXISTS document_supersedes_idx
  ON app.document(supersedes_document_id)
  WHERE supersedes_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_upload_idx
  ON app.document(upload_id)
  WHERE upload_id IS NOT NULL;

-- Free key and value pairs for the kinds with no dedicated content table, so a new kind needs no migration.
CREATE TABLE IF NOT EXISTS app.document_attribute (
  document_id uuid NOT NULL,
  organization_id text NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  CONSTRAINT document_attribute_pkey PRIMARY KEY (document_id, key),
  CONSTRAINT document_attribute_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT document_attribute_value_check CHECK (length(value) <= 2000),
  CONSTRAINT document_attribute_document_fkey FOREIGN KEY (document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE CASCADE
);

-- The primary key leads with document_id, so the tenant predicate needs an index of its own.
CREATE INDEX IF NOT EXISTS document_attribute_organization_idx
  ON app.document_attribute(organization_id, document_id);

-- Invoice content shares the register's primary key: one invoice per document, never a second revision row.
CREATE TABLE IF NOT EXISTS app.invoice (
  document_id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  tax_point_date date,
  due_date date,
  received_date date,
  variable_symbol text,
  fx_rate numeric(18, 6),
  base_total numeric(19, 4) NOT NULL,
  vat_total numeric(19, 4) NOT NULL,
  gross_total numeric(19, 4) NOT NULL,
  CONSTRAINT invoice_variable_symbol_check
    CHECK (variable_symbol IS NULL OR variable_symbol ~ '^[0-9]{1,10}$'),
  CONSTRAINT invoice_fx_rate_check CHECK (fx_rate IS NULL OR fx_rate > 0),
  -- Totals are computed from the lines by the API, so the database only has to refuse an inconsistent trio.
  CONSTRAINT invoice_totals_check CHECK (gross_total = base_total + vat_total),
  -- Direction lives in the document kind, never in the sign: a refund is a credit_note, not a negative invoice.
  CONSTRAINT invoice_totals_sign_check CHECK (base_total >= 0 AND vat_total >= 0),
  -- Lets app.invoice_line carry a composite foreign key that pins its organization_id to this row's.
  CONSTRAINT invoice_document_organization_key UNIQUE (document_id, organization_id),
  CONSTRAINT invoice_document_fkey FOREIGN KEY (document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS invoice_organization_idx ON app.invoice(organization_id, document_id);

CREATE TABLE IF NOT EXISTS app.invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  document_id uuid NOT NULL,
  line_no integer NOT NULL,
  description text NOT NULL,
  -- Drives which revenue or expense account the derivation picks, so it is a closed vocabulary.
  category text NOT NULL,
  quantity numeric(19, 4),
  unit text,
  unit_price numeric(19, 4),
  base_amount numeric(19, 4) NOT NULL,
  vat_mode text NOT NULL,
  vat_rate numeric(5, 2) NOT NULL DEFAULT 0,
  vat_amount numeric(19, 4) NOT NULL DEFAULT 0,
  -- The account the source system used, kept for comparison only: BAP derives its own from category.
  source_account_code text,
  CONSTRAINT invoice_line_line_no_check CHECK (line_no >= 1),
  CONSTRAINT invoice_line_description_check CHECK (length(description) BETWEEN 1 AND 500),
  CONSTRAINT invoice_line_category_check
    CHECK (category IN ('goods', 'material', 'services', 'asset', 'other')),
  CONSTRAINT invoice_line_unit_check CHECK (unit IS NULL OR length(unit) <= 16),
  CONSTRAINT invoice_line_vat_mode_check
    CHECK (vat_mode IN ('standard', 'reverse_charge', 'exempt', 'outside_scope')),
  CONSTRAINT invoice_line_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 100),
  -- The same rule as the totals: a line amount is never negative, because direction lives in the document kind.
  CONSTRAINT invoice_line_base_amount_check CHECK (base_amount >= 0),
  CONSTRAINT invoice_line_vat_amount_check CHECK (vat_amount >= 0),
  CONSTRAINT invoice_line_source_account_code_check
    CHECK (source_account_code IS NULL OR source_account_code ~ '^[0-9]{3}(\.[0-9A-Za-z]+)?$'),
  CONSTRAINT invoice_line_document_line_key UNIQUE (document_id, line_no),
  -- Lets app.economic_event_line point back at the exact line it was derived from.
  CONSTRAINT invoice_line_id_organization_key UNIQUE (id, organization_id),
  -- Reverse charge, exempt and outside scope carry no VAT on the invoice itself.
  CONSTRAINT invoice_line_vat_zero_check CHECK (vat_mode = 'standard' OR vat_amount = 0),
  -- Half a unit of tolerance: source systems round per line or per rate, and a rounding difference is not an error.
  CONSTRAINT invoice_line_vat_tolerance_check
    CHECK (vat_mode <> 'standard' OR abs(vat_amount - round(base_amount * vat_rate / 100, 2)) <= 0.5),
  CONSTRAINT invoice_line_invoice_fkey FOREIGN KEY (document_id, organization_id)
    REFERENCES app.invoice(document_id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS invoice_line_organization_idx
  ON app.invoice_line(organization_id, document_id, line_no);

-- Derived and rebuildable: every write of an invoice replaces this row, so it is never edited by hand.
CREATE TABLE IF NOT EXISTS app.economic_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  legal_entity_id uuid NOT NULL,
  document_id uuid NOT NULL,
  event_date date NOT NULL,
  -- Names the rule set that produced the lines, so changing rules means a new version and a re-derivation.
  rule_set_version text NOT NULL,
  -- Stored rather than computed: an imbalance is a data issue to report, never a rejected write.
  is_balanced boolean NOT NULL,
  debit_total numeric(19, 4) NOT NULL,
  credit_total numeric(19, 4) NOT NULL,
  derived_at timestamptz NOT NULL DEFAULT now(),
  -- One current event per document: keeping history would be a second source of truth with no reader.
  CONSTRAINT economic_event_document_key UNIQUE (document_id),
  CONSTRAINT economic_event_id_organization_key UNIQUE (id, organization_id),
  CONSTRAINT economic_event_document_fkey FOREIGN KEY (document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE CASCADE,
  -- Denormalized from the document so entity scoped reporting never has to join the register.
  CONSTRAINT economic_event_legal_entity_fkey FOREIGN KEY (legal_entity_id, organization_id)
    REFERENCES app.legal_entity(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS economic_event_entity_date_idx
  ON app.economic_event(organization_id, legal_entity_id, event_date);

CREATE TABLE IF NOT EXISTS app.economic_event_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  event_id uuid NOT NULL,
  line_no integer NOT NULL,
  account_code char(3) NOT NULL,
  side text NOT NULL,
  amount numeric(19, 4) NOT NULL,
  partner_id uuid,
  invoice_line_id uuid,
  description text,
  CONSTRAINT economic_event_line_line_no_check CHECK (line_no >= 1),
  CONSTRAINT economic_event_line_side_check CHECK (side IN ('debit', 'credit')),
  -- Sign lives in side, never in the amount, so a report never has to guess which convention a row uses.
  CONSTRAINT economic_event_line_amount_check CHECK (amount > 0),
  CONSTRAINT economic_event_line_description_check
    CHECK (description IS NULL OR length(description) <= 500),
  CONSTRAINT economic_event_line_event_line_key UNIQUE (event_id, line_no),
  -- Plain reference: the chart of accounts is shared reference data with no tenant column to pin.
  CONSTRAINT economic_event_line_account_fkey FOREIGN KEY (account_code)
    REFERENCES app.directive_account(code),
  CONSTRAINT economic_event_line_event_fkey FOREIGN KEY (event_id, organization_id)
    REFERENCES app.economic_event(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT economic_event_line_partner_fkey FOREIGN KEY (partner_id, organization_id)
    REFERENCES app.partner(id, organization_id) ON DELETE SET NULL (partner_id),
  CONSTRAINT economic_event_line_invoice_line_fkey FOREIGN KEY (invoice_line_id, organization_id)
    REFERENCES app.invoice_line(id, organization_id) ON DELETE SET NULL (invoice_line_id)
);

-- The account drill-down is the one read that does not start from a document, so it gets its own index.
CREATE INDEX IF NOT EXISTS economic_event_line_account_idx
  ON app.economic_event_line(organization_id, account_code, event_id);

-- Reading one event reads its lines in order, which is the most common event line access of all.
CREATE INDEX IF NOT EXISTS economic_event_line_event_idx
  ON app.economic_event_line(organization_id, event_id, line_no);

-- Both references are nullable and mostly set, and both are cleared by ON DELETE SET NULL, which scans without them.
CREATE INDEX IF NOT EXISTS economic_event_line_invoice_line_idx
  ON app.economic_event_line(invoice_line_id)
  WHERE invoice_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS economic_event_line_partner_idx
  ON app.economic_event_line(partner_id)
  WHERE partner_id IS NOT NULL;

-- Generic and directed: any kind may link to any other, so settlement and correction need no separate tables.
CREATE TABLE IF NOT EXISTS app.document_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  from_document_id uuid NOT NULL,
  to_document_id uuid NOT NULL,
  kind text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_link_kind_check
    CHECK (kind IN ('settles', 'fulfills', 'corrects', 'supersedes', 'relates')),
  CONSTRAINT document_link_unique UNIQUE (from_document_id, to_document_id, kind),
  CONSTRAINT document_link_distinct_check CHECK (from_document_id <> to_document_id),
  CONSTRAINT document_link_from_fkey FOREIGN KEY (from_document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT document_link_to_fkey FOREIGN KEY (to_document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE CASCADE
);

-- The unique constraint indexes the outgoing direction only, so the incoming lookup needs its own index.
CREATE INDEX IF NOT EXISTS document_link_to_idx ON app.document_link(organization_id, to_document_id);

-- Derivation reports its findings here instead of failing the write, which keeps registration always possible.
CREATE TABLE IF NOT EXISTS app.data_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  document_id uuid NOT NULL,
  code text NOT NULL,
  severity text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT data_issue_code_check
    CHECK (code IN ('unbalanced_event', 'unmapped_line', 'missing_partner', 'total_mismatch')),
  CONSTRAINT data_issue_severity_check CHECK (severity IN ('warning', 'error')),
  CONSTRAINT data_issue_detail_check CHECK (detail IS NULL OR length(detail) <= 500),
  CONSTRAINT data_issue_document_fkey FOREIGN KEY (document_id, organization_id)
    REFERENCES app.document(id, organization_id) ON DELETE CASCADE
);

-- Partial on the open state: one open issue per code and document, while resolved history may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS data_issue_open_key
  ON app.data_issue(document_id, code)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS data_issue_organization_idx ON app.data_issue(organization_id, document_id);

-- app.directive_account is deliberately absent: shared reference data has no tenant to isolate.
ALTER TABLE app.partner ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.partner FORCE ROW LEVEL SECURITY;
ALTER TABLE app.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document FORCE ROW LEVEL SECURITY;
ALTER TABLE app.document_attribute ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_attribute FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invoice FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invoice_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invoice_line FORCE ROW LEVEL SECURITY;
ALTER TABLE app.economic_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.economic_event FORCE ROW LEVEL SECURITY;
ALTER TABLE app.economic_event_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.economic_event_line FORCE ROW LEVEL SECURITY;
ALTER TABLE app.document_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_link FORCE ROW LEVEL SECURITY;
ALTER TABLE app.data_issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.data_issue FORCE ROW LEVEL SECURITY;

-- Split per command on purpose: one ALL policy would let its read clause govern DELETE and the row selection of UPDATE.
-- Reading a document is a member level action; every write needs owner or admin, exactly like datasets after ADR 0011.
CREATE POLICY partner_select ON app.partner FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY partner_insert ON app.partner FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY partner_update ON app.partner FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY partner_delete ON app.partner FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_select ON app.document FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY document_insert ON app.document FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_update ON app.document FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_delete ON app.document FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_attribute_select ON app.document_attribute FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY document_attribute_insert ON app.document_attribute FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_attribute_update ON app.document_attribute FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_attribute_delete ON app.document_attribute FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY invoice_select ON app.invoice FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY invoice_insert ON app.invoice FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY invoice_update ON app.invoice FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY invoice_delete ON app.invoice FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY invoice_line_select ON app.invoice_line FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY invoice_line_insert ON app.invoice_line FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY invoice_line_update ON app.invoice_line FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY invoice_line_delete ON app.invoice_line FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY economic_event_select ON app.economic_event FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY economic_event_insert ON app.economic_event FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY economic_event_update ON app.economic_event FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY economic_event_delete ON app.economic_event FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY economic_event_line_select ON app.economic_event_line FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY economic_event_line_insert ON app.economic_event_line FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY economic_event_line_update ON app.economic_event_line FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY economic_event_line_delete ON app.economic_event_line FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_link_select ON app.document_link FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY document_link_insert ON app.document_link FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND created_by = current_setting('bap.user_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_link_update ON app.document_link FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY document_link_delete ON app.document_link FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY data_issue_select ON app.data_issue FOR SELECT
  USING (organization_id = current_setting('bap.organization_id', true));

CREATE POLICY data_issue_insert ON app.data_issue FOR INSERT
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY data_issue_update ON app.data_issue FOR UPDATE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  )
  WITH CHECK (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

CREATE POLICY data_issue_delete ON app.data_issue FOR DELETE
  USING (
    organization_id = current_setting('bap.organization_id', true)
    AND app.role_can_write()
  );

GRANT USAGE ON SCHEMA app TO bap_api, bap_reporting;

-- Shared reference data is readable by every service role and carries no write grant at all.
GRANT SELECT ON app.directive_account TO bap_api, bap_reporting, bap_backup;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.partner,
  app.document,
  app.document_attribute,
  app.invoice,
  app.invoice_line,
  app.economic_event,
  app.economic_event_line,
  app.document_link,
  app.data_issue
TO bap_api;

GRANT SELECT ON
  app.partner,
  app.document,
  app.document_attribute,
  app.invoice,
  app.invoice_line,
  app.economic_event,
  app.economic_event_line,
  app.document_link,
  app.data_issue
TO bap_reporting;

-- Default privileges under bap_owner already cover these, but the whole database dump must not depend on them.
GRANT SELECT ON
  app.partner,
  app.document,
  app.document_attribute,
  app.invoice,
  app.invoice_line,
  app.economic_event,
  app.economic_event_line,
  app.document_link,
  app.data_issue
TO bap_backup;

-- The eraser keeps column-scoped grants only: these three tables are the new ones carrying an attribution column.
GRANT SELECT (created_by), UPDATE (created_by) ON app.document TO bap_eraser;
GRANT SELECT (created_by), UPDATE (created_by) ON app.partner TO bap_eraser;
GRANT SELECT (created_by), UPDATE (created_by) ON app.document_link TO bap_eraser;

-- Documents, partners and links join the erasure: their rows survive, attributed to the tombstone.
CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  tombstone text;
BEGIN
  IF coalesce(subject_user_id, '') = '' THEN
    RAISE EXCEPTION 'User erasure requires an explicit subject';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.dataset WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.member_entity_scope
    WHERE user_id = subject_user_id OR updated_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.legal_entity_access
    WHERE user_id = subject_user_id OR created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.partner WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document_link WHERE created_by = subject_user_id
  ) THEN
    RETURN NULL;
  END IF;

  tombstone := 'erased_' || gen_random_uuid()::text;

  UPDATE app.audit_log
  SET user_id = tombstone
  WHERE user_id = subject_user_id;

  UPDATE app.dataset
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.legal_entity
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  DELETE FROM app.legal_entity_access
  WHERE user_id = subject_user_id;

  DELETE FROM app.member_entity_scope
  WHERE user_id = subject_user_id;

  -- Rows the subject wrote for someone else survive, attributed to the tombstone.
  UPDATE app.member_entity_scope
  SET updated_by = tombstone
  WHERE updated_by = subject_user_id;

  UPDATE app.legal_entity_access
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.document
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.partner
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.document_link
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  RETURN tombstone;
END;
$$;

-- Reserve the top-level documents route before it is published.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.organization
    WHERE slug = 'documents'
  ) THEN
    RAISE EXCEPTION 'Reserved organization slug is already in use'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'organization_slug_reserved_check';
  END IF;
END;
$$;

ALTER TABLE auth.organization
  DROP CONSTRAINT organization_slug_reserved_check;

ALTER TABLE auth.organization
  ADD CONSTRAINT organization_slug_reserved_check
    CHECK (
      slug NOT IN (
        'access',
        'api',
        'datasets',
        'design-system',
        'health',
        'invitation',
        'metrics',
        'ready',
        'sign-in',
        'sign-up',
        'forgot-password',
        'reset-password',
        'activate',
        'welcome',
        'account',
        'organizations',
        'documents'
      )
    );
