package AllStereotypes {
    private import SCDL::*;

    package Architecture {
        part 'SYS' {
            @ScdlElement { title = "システム"; weight = Asil::B; }
            part 'SYS-A' {
                @ScdlElement { weight = Asil::B; }
            }
            part 'SYS-B' {
                @ScdlElement { weight = Asil::A; decomposedFrom = Asil::B; }
            }
            part 'SYS-C' {
                @ScdlElement { weight = Asil::B; }
            }
        }
    }

    package Requirements {
        requirement 'R-1' {
            @ScdlRequirement { title = "入力検知"; note = "ドライバの操作量を検知する"; weight = Asil::B; }
        }
        requirement 'R-2' {
            @ScdlRequirement { title = "冗長検知"; weight = Asil::A; decomposedFrom = Asil::B; }
        }
        requirement 'R-3' {
            @ScdlRequirement { weight = Asil::B; }
        }
        requirement 'X-IN' {
            @ScdlRequirement { isExternal = true; }
        }
    }

    package Constraints {
        requirement 'NF-1' {
            @ScdlConstraint { note = "G-1 と G-2 が同時侵害となる従属故障なきこと"; weight = Asil::B; }
        }
        requirement 'NF-2' {
            @ScdlConstraint { weight = Asil::B; }
        }
        requirement 'NF-3' {
            @ScdlConstraint { weight = Asil::B; }
        }
    }

    package Groups {
        metadata 'G-1' : ScdlRequirementGroup about AllStereotypes::Requirements::'R-1' { title = "Main Function"; role = ScdlGroupRole::intendedFunction; }
        metadata 'G-2' : ScdlRequirementGroup about AllStereotypes::Requirements::'R-2' { title = "Safety Mechanism"; role = ScdlGroupRole::safetyMechanism; }
    }

    package Interactions {
        dependency 'I-1' from AllStereotypes::Requirements::'X-IN' to AllStereotypes::Requirements::'R-1' {
            @ScdlInteraction { title = "操作量"; }
        }
        dependency 'I-2' from AllStereotypes::Requirements::'R-1' to AllStereotypes::Requirements::'R-2', AllStereotypes::Requirements::'R-3' {
            @ScdlInteraction;
        }
    }

    package GroupPairings {
        dependency 'P-1' from AllStereotypes::Groups::'G-1' to AllStereotypes::Groups::'G-2' {
            @ScdlRequirementGroupPairing;
        }
    }

    package RequirementPairings {
        dependency 'RP-1' from AllStereotypes::Requirements::'R-1' to AllStereotypes::Requirements::'R-2' {
            @ScdlRequirementPairing;
        }
    }

    package Coexistences {
        dependency 'CX-1' from AllStereotypes::Architecture::'SYS'::'SYS-A' to AllStereotypes::Requirements::'R-2' {
            @ScdlCoexistence;
        }
        dependency 'CX-2' from AllStereotypes::Architecture::'SYS'::'SYS-A' to AllStereotypes::Groups::'G-2' {
            @ScdlCoexistence;
        }
        dependency 'CX-3' from AllStereotypes::Architecture::'SYS'::'SYS-C' to AllStereotypes::Architecture::'SYS'::'SYS-B' {
            @ScdlCoexistence;
        }
    }

    package ConstraintPairings {
        dependency 'C-1' from AllStereotypes::Constraints::'NF-1' to AllStereotypes::GroupPairings::'P-1' {
            @ScdlConstraintPairing;
        }
        dependency 'C-2' from AllStereotypes::Constraints::'NF-2' to AllStereotypes::RequirementPairings::'RP-1' {
            @ScdlConstraintPairing;
        }
        dependency 'C-3' from AllStereotypes::Constraints::'NF-3' to AllStereotypes::Coexistences::'CX-1' {
            @ScdlConstraintPairing;
        }
        dependency 'C-4' from AllStereotypes::Constraints::'NF-3' to AllStereotypes::Coexistences::'CX-2' {
            @ScdlConstraintPairing;
        }
        dependency 'C-5' from AllStereotypes::Constraints::'NF-3' to AllStereotypes::Coexistences::'CX-3' {
            @ScdlConstraintPairing;
        }
    }

    package Allocations {
        satisfy AllStereotypes::Requirements::'R-1' by AllStereotypes::Architecture::'SYS'.'SYS-A';
        satisfy AllStereotypes::Requirements::'R-2' by AllStereotypes::Architecture::'SYS'.'SYS-B';
        satisfy AllStereotypes::Requirements::'R-3' by AllStereotypes::Architecture::'SYS'.'SYS-C';
        satisfy AllStereotypes::Constraints::'NF-1' by AllStereotypes::Architecture::'SYS';
        satisfy AllStereotypes::Constraints::'NF-2' by AllStereotypes::Architecture::'SYS';
        satisfy AllStereotypes::Constraints::'NF-3' by AllStereotypes::Architecture::'SYS';
    }
}
