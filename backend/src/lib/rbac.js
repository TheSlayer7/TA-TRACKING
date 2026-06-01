const roles = ['Admin', 'Faculty', 'TA'];

const roleHierarchy = {
  TA: 1,
  Faculty: 2,
  Admin: 3
};

const permissions = [
  { code: 'users:create', description: 'Create new users' },
  { code: 'users:update', description: 'Update user profiles' },
  { code: 'users:delete', description: 'Delete users' },
  { code: 'roles:assign', description: 'Assign roles to users' },
  { code: 'courses:manage', description: 'Create and manage courses' },
  { code: 'courses:view', description: 'View course lists and details' },
  { code: 'tasks:assign', description: 'Assign tasks to teaching assistants' },
  { code: 'tasks:view:assigned', description: 'View assigned tasks' },
  { code: 'tasks:update', description: 'Update task status' },
  { code: 'submissions:view', description: 'View task submissions and work logs' },
  { code: 'worklogs:submit', description: 'Submit work logs' },
  { code: 'worklogs:review', description: 'Approve or reject work logs' },
  { code: 'activity:view:own', description: 'View personal activity history' },
  { code: 'reports:view:own', description: 'View personal workload reports' },
  { code: 'reports:view:faculty', description: 'View faculty course reports' },
  { code: 'reports:view:all', description: 'View all system reports' }
];

const rolePermissions = {
  Admin: [
    'users:create',
    'users:update',
    'users:delete',
    'roles:assign',
    'courses:manage',
    'courses:view',
    'tasks:assign',
    'tasks:view:assigned',
    'tasks:update',
    'submissions:view',
    'worklogs:submit',
    'worklogs:review',
    'activity:view:own',
    'reports:view:own',
    'reports:view:faculty',
    'reports:view:all'
  ],
  Faculty: [
    'courses:view',
    'tasks:assign',
    'tasks:view:assigned',
    'tasks:update',
    'submissions:view',
    'worklogs:review',
    'activity:view:own',
    'reports:view:own',
    'reports:view:faculty'
  ],
  TA: [
    'courses:view',
    'tasks:view:assigned',
    'tasks:update',
    'worklogs:submit',
    'activity:view:own',
    'reports:view:own'
  ]
};

const roleAliases = {
  accounts: 'Faculty',
  account: 'Faculty',
  'accounts department': 'Faculty',
  'accounts dept': 'Faculty',
  administrator: 'Admin',
  admin: 'Admin',
  employee: 'TA',
  employees: 'TA',
  emp: 'TA',
  faculty: 'Faculty',
  professor: 'Faculty',
  lecturer: 'Faculty',
  ta: 'TA'
};

const getRoleLevel = (role) => roleHierarchy[String(role || '').trim()] || 0;

const roleHasAtLeast = (currentRole, requiredRole) => getRoleLevel(currentRole) >= getRoleLevel(requiredRole);

const roleHasPermission = (currentRole, permissionCode) => rolePermissions[currentRole]?.includes(permissionCode) || false;

const normalizeRole = (role) => {
  const normalized = String(role || '').trim();
  const alias = roleAliases[normalized.toLowerCase()];

  if (alias) {
    return alias;
  }

  return roles.includes(normalized) ? normalized : 'TA';
};

module.exports = {
  roles,
  permissions,
  rolePermissions,
  roleHierarchy,
  getRoleLevel,
  roleHasAtLeast,
  roleHasPermission,
  normalizeRole
};