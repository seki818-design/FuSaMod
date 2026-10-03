package RedundantArchitecture {
    private import SCDL::*;

    package Architecture {
        part 'ITEM' {
            @ScdlElement { weight = Asil::B; }
            part 'E-1' {
                @ScdlElement { weight = Asil::B; }
                part 'E-1-1' {
                    @ScdlElement { weight = Asil::A; decomposedFrom = Asil::B; }
                }
                part 'E-1-2' {
                    @ScdlElement { weight = Asil::B; }
                }
            }
            part 'E-2' {
                @ScdlElement { weight = Asil::B; }
                part 'E-2-1' {
                    @ScdlElement { weight = Asil::A; decomposedFrom = Asil::B; }
                }
                part 'E-2-2' {
                    @ScdlElement { weight = Asil::B; }
                }
            }
            part 'E-3' {
                @ScdlElement { weight = Asil::B; }
                part 'E-3-1' {
                    @ScdlElement { weight = Asil::A; decomposedFrom = Asil::B; }
                }
                part 'E-3-2' {
                    @ScdlElement { weight = Asil::A; decomposedFrom = Asil::B; }
                }
            }
        }
    }

    package Requirements {
        requirement 'MFR-1' {
            @ScdlRequirement { weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'SR-11' {
            @ScdlRequirement { weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'SR-12' {
            @ScdlRequirement { weight = Asil::B; }
        }
        requirement 'MFR-2' {
            @ScdlRequirement { weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'SR-21' {
            @ScdlRequirement { weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'SR-22' {
            @ScdlRequirement { weight = Asil::B; }
        }
        requirement 'MFR-3' {
            @ScdlRequirement { weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'SR-31' {
            @ScdlRequirement { weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'SR-32' {
            @ScdlRequirement { weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'SR-33' {
            @ScdlRequirement { weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'X-DRV1' {
            @ScdlRequirement { isExternal = true; }
        }
        requirement 'X-DRV2' {
            @ScdlRequirement { isExternal = true; }
        }
        requirement 'X-ANGLE' {
            @ScdlRequirement { isExternal = true; }
        }
        requirement 'X-ACT' {
            @ScdlRequirement { isExternal = true; }
        }
    }

    package Constraints {
        requirement 'NFSR-1' {
            @ScdlConstraint { weight = Asil::B; }
        }
        requirement 'NFSR-2' {
            @ScdlConstraint { weight = Asil::B; }
        }
        requirement 'NFSR-3' {
            @ScdlConstraint { weight = Asil::B; }
        }
    }

    package Groups {
        metadata 'RG-1' : ScdlRequirementGroup about RedundantArchitecture::Requirements::'MFR-1' { title = "Main Function"; role = ScdlGroupRole::intendedFunction; }
        metadata 'SRG-1' : ScdlRequirementGroup about RedundantArchitecture::Requirements::'SR-11', RedundantArchitecture::Requirements::'SR-12' { title = "Safety Mechanism"; role = ScdlGroupRole::safetyMechanism; }
        metadata 'RG-2' : ScdlRequirementGroup about RedundantArchitecture::Requirements::'MFR-2' { title = "Main Function"; role = ScdlGroupRole::intendedFunction; }
        metadata 'SRG-2' : ScdlRequirementGroup about RedundantArchitecture::Requirements::'SR-21', RedundantArchitecture::Requirements::'SR-22' { title = "Safety Mechanism"; role = ScdlGroupRole::safetyMechanism; }
        metadata 'RG-3' : ScdlRequirementGroup about RedundantArchitecture::Requirements::'MFR-3' { title = "Main Function"; role = ScdlGroupRole::intendedFunction; }
        metadata 'SRG-3' : ScdlRequirementGroup about RedundantArchitecture::Requirements::'SR-31', RedundantArchitecture::Requirements::'SR-32', RedundantArchitecture::Requirements::'SR-33' { title = "Safety Mechanism"; role = ScdlGroupRole::safetyMechanism; }
    }

    package Interactions {
        dependency 'I-1' from RedundantArchitecture::Requirements::'X-DRV1' to RedundantArchitecture::Requirements::'MFR-1' {
            @ScdlInteraction;
        }
        dependency 'I-2' from RedundantArchitecture::Requirements::'X-DRV2' to RedundantArchitecture::Requirements::'SR-11' {
            @ScdlInteraction;
        }
        dependency 'I-3' from RedundantArchitecture::Requirements::'MFR-1' to RedundantArchitecture::Requirements::'SR-12' {
            @ScdlInteraction;
        }
        dependency 'I-4' from RedundantArchitecture::Requirements::'SR-11' to RedundantArchitecture::Requirements::'SR-12' {
            @ScdlInteraction;
        }
        dependency 'I-5' from RedundantArchitecture::Requirements::'SR-12' to RedundantArchitecture::Requirements::'MFR-2', RedundantArchitecture::Requirements::'SR-21' {
            @ScdlInteraction;
        }
        dependency 'I-6' from RedundantArchitecture::Requirements::'MFR-2' to RedundantArchitecture::Requirements::'SR-22' {
            @ScdlInteraction;
        }
        dependency 'I-7' from RedundantArchitecture::Requirements::'SR-21' to RedundantArchitecture::Requirements::'SR-22' {
            @ScdlInteraction;
        }
        dependency 'I-8' from RedundantArchitecture::Requirements::'SR-22' to RedundantArchitecture::Requirements::'MFR-3', RedundantArchitecture::Requirements::'SR-31' {
            @ScdlInteraction;
        }
        dependency 'I-9' from RedundantArchitecture::Requirements::'MFR-3' to RedundantArchitecture::Requirements::'SR-33' {
            @ScdlInteraction;
        }
        dependency 'I-10' from RedundantArchitecture::Requirements::'SR-32' to RedundantArchitecture::Requirements::'SR-31' {
            @ScdlInteraction;
        }
        dependency 'I-11' from RedundantArchitecture::Requirements::'SR-31' to RedundantArchitecture::Requirements::'SR-33' {
            @ScdlInteraction;
        }
        dependency 'I-12' from RedundantArchitecture::Requirements::'X-ANGLE' to RedundantArchitecture::Requirements::'SR-32' {
            @ScdlInteraction;
        }
        dependency 'I-13' from RedundantArchitecture::Requirements::'SR-33' to RedundantArchitecture::Requirements::'X-ACT' {
            @ScdlInteraction;
        }
    }

    package GroupPairings {
        dependency 'P-1' from RedundantArchitecture::Groups::'RG-1' to RedundantArchitecture::Groups::'SRG-1' {
            @ScdlRequirementGroupPairing;
        }
        dependency 'P-2' from RedundantArchitecture::Groups::'RG-2' to RedundantArchitecture::Groups::'SRG-2' {
            @ScdlRequirementGroupPairing;
        }
        dependency 'P-3' from RedundantArchitecture::Groups::'RG-3' to RedundantArchitecture::Groups::'SRG-3' {
            @ScdlRequirementGroupPairing;
        }
    }

    package RequirementPairings {
    }

    package Coexistences {
    }

    package ConstraintPairings {
        dependency 'C-1' from RedundantArchitecture::Constraints::'NFSR-1' to RedundantArchitecture::GroupPairings::'P-1' {
            @ScdlConstraintPairing;
        }
        dependency 'C-2' from RedundantArchitecture::Constraints::'NFSR-2' to RedundantArchitecture::GroupPairings::'P-2' {
            @ScdlConstraintPairing;
        }
        dependency 'C-3' from RedundantArchitecture::Constraints::'NFSR-3' to RedundantArchitecture::GroupPairings::'P-3' {
            @ScdlConstraintPairing;
        }
    }

    package Allocations {
        satisfy RedundantArchitecture::Requirements::'MFR-1' by RedundantArchitecture::Architecture::'ITEM'.'E-1'.'E-1-1';
        satisfy RedundantArchitecture::Requirements::'SR-11' by RedundantArchitecture::Architecture::'ITEM'.'E-1'.'E-1-2';
        satisfy RedundantArchitecture::Requirements::'SR-12' by RedundantArchitecture::Architecture::'ITEM'.'E-1'.'E-1-2';
        satisfy RedundantArchitecture::Requirements::'MFR-2' by RedundantArchitecture::Architecture::'ITEM'.'E-2'.'E-2-1';
        satisfy RedundantArchitecture::Requirements::'SR-21' by RedundantArchitecture::Architecture::'ITEM'.'E-2'.'E-2-2';
        satisfy RedundantArchitecture::Requirements::'SR-22' by RedundantArchitecture::Architecture::'ITEM'.'E-2'.'E-2-2';
        satisfy RedundantArchitecture::Requirements::'MFR-3' by RedundantArchitecture::Architecture::'ITEM'.'E-3'.'E-3-2';
        satisfy RedundantArchitecture::Requirements::'SR-31' by RedundantArchitecture::Architecture::'ITEM'.'E-3'.'E-3-1';
        satisfy RedundantArchitecture::Requirements::'SR-32' by RedundantArchitecture::Architecture::'ITEM'.'E-3'.'E-3-1';
        satisfy RedundantArchitecture::Requirements::'SR-33' by RedundantArchitecture::Architecture::'ITEM'.'E-3'.'E-3-1';
        satisfy RedundantArchitecture::Constraints::'NFSR-1' by RedundantArchitecture::Architecture::'ITEM'.'E-1';
        satisfy RedundantArchitecture::Constraints::'NFSR-2' by RedundantArchitecture::Architecture::'ITEM'.'E-2';
        satisfy RedundantArchitecture::Constraints::'NFSR-3' by RedundantArchitecture::Architecture::'ITEM'.'E-3';
    }
}
