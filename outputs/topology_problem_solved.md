# Network Topology - Problem Analysis

## Core Switches
- Core_SW_01 (Huawei) - Layer 3 Core
- Core_SW_02 (Cisco) - Layer 3 Core

## Aggregation Switches (Layer 2 Only)
- AGG_SW_01 (Huawei) - VLANs: 10, 100, 110, 120
- AGG_SW_02 (Huawei) - VLANs: 20, 100, 110, 120
- AGG_SW_03 (Huawei) - VLANs: 30, 100, 110, 120
- AGG_SW_04 (Huawei) - VLANs: 40, 100, 110, 120

## Firewall Pair
- FW_01 (Huawei)
- FW_02 (Huawei)

## Problem Analysis
- **Missing Network**: 10.1.60.0/24 (VLAN 60)
- **Status**: VLAN 60 is NOT configured on ANY switch in the network
- **Impact**: No static route exists for 10.1.60.0/24 in Core_SW_01, Core_SW_02, FW_01, or FW_02
- **Root Cause**: Configuration error - VLAN 60 was never deployed to the network

## Working Network Segments
- VLAN 10: HQ_MKT (10.1.10.0/24) - CONFIGURED
- VLAN 20: HQ_FIN (10.1.20.0/24) - CONFIGURED
- VLAN 30: HQ_HR (10.1.30.0/24) - CONFIGURED
- VLAN 40: HQ_PROC (10.1.40.0/24) - CONFIGURED
- VLAN 100: AP Network - CONFIGURED
- VLAN 110: MGMT - CONFIGURED
- VLAN 120: GUEST_WIFI (10.1.120.0/24) - CONFIGURED & WORKING

## Missing Network
- VLAN 60: Should be 10.1.60.0/24 - NOT CONFIGURED ANYWHERE