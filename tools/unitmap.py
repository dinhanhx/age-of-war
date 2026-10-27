# unit id -> {state: sprite id}. Source: decompiled Symbol 687 chain (see plan). Unit 16 reuses 14.
UNITS = {
 1:  dict(idle=230, walk=231, attack=237, die=245),
 2:  dict(idle=259, walk=260, attack=263, die=264, shoot=278, shootwalk=280),
 3:  dict(idle=310, walk=311, attack=315, die=317),
 4:  dict(idle=334, walk=335, attack=348, die=349),
 5:  dict(idle=369, walk=370, attack=380, die=381, shoot=393, shootwalk=404),
 6:  dict(idle=448, walk=449, attack=450, die=452),
 7:  dict(idle=468, walk=469, attack=471, die=472),
 8:  dict(idle=478, walk=479, attack=482, die=483, shoot=482, shootwalk=484),
 9:  dict(idle=494, walk=495, attack=497, die=498),
 10: dict(idle=514, walk=515, attack=516, die=517),
 11: dict(idle=521, walk=522, attack=532, die=533, shoot=542, shootwalk=551),
 12: dict(idle=568, walk=569, attack=573, die=607),
 13: dict(idle=630, walk=631, attack=639, die=640),
 14: dict(idle=646, walk=647, attack=654, die=655, shoot=661, shootwalk=662),
 15: dict(idle=676, attack=681, die=685),
}
UNITS[16] = dict(UNITS[14])
