export PGPASSWORD=lotus
psql -h localhost -U lotus lotus -q <<'S' 2>&1 | grep -v NOTICE
truncate players cascade;
insert into inventory_items(nft_mint,card_name,grade,value_usd,tier) values
('MintCommon111111111111111111111111111111111','2019 Prizm Rookie','PSA 9',18,'common'),
('MintCommon222222222222222222222222222222222','1999 Base Charizard','BGS 8',25,'common'),
('MintUncom1111111111111111111111111111111111','2003 Topps Chrome','PSA 10',55,'uncommon'),
('MintRare11111111111111111111111111111111111','1986 Fleer Jordan','PSA 8',210,'rare'),
('MintGrail1111111111111111111111111111111111','1952 Topps Mantle','PSA 5',1800,'grail');
update odds_config set weight = case tier when 'common' then 1000000 else 0 end where crate_kind='standard';
S
redis-cli flushall >/dev/null
