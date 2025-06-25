const { useState, useEffect } = React;

const App = () => {
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [mustChangePassword, setMustChangePassword] = useState(false);
    const [loginData, setLoginData] = useState({ username: '', password: '' });
    const [changePasswordData, setChangePasswordData] = useState({ newPassword: '', confirmPassword: '' });
    const [view, setView] = useState(token ? 'dashboard' : 'login');
    const [radios, setRadios] = useState([]);
    const [newRadio, setNewRadio] = useState({ name: '', stream_url: '', now_playing_api: '', enabled: true });
    const [editingRadioId, setEditingRadioId] = useState(null);
    const [users, setUsers] = useState([]);
    const [newUser, setNewUser] = useState({ username: '', password: '', enabled: true });
    const [editingUserId, setEditingUserId] = useState(null);
    const [error, setError] = useState('');

    // Set axios default headers
    useEffect(() => {
        if (token) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        } else {
            delete axios.defaults.headers.common['Authorization'];
        }
    }, [token]);

    // Check token validity
    useEffect(() => {
        if (token && view === 'login') {
            axios.get('/admin/radios').then(response => {
                setView('dashboard');
            }).catch(() => {
                localStorage.removeItem('token');
                setToken(null);
                setView('login');
            });
        }
    }, [token]);

    // Handle login
    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const response = await axios.post('/admin/login', loginData);
            localStorage.setItem('token', response.data.token);
            setToken(response.data.token);
            setMustChangePassword(response.data.mustChangePassword);
            setView(response.data.mustChangePassword ? 'changePassword' : 'dashboard');
            setLoginData({ username: '', password: '' });
        } catch (error) {
            setError(error.response?.data?.error || 'Server error');
        }
    };

    // Handle password change
    const handleChangePassword = async (e) => {
        e.preventDefault();
        setError('');
        if (changePasswordData.newPassword !== changePasswordData.confirmPassword) {
            return setError('Passwords do not match');
        }
        if (changePasswordData.newPassword.length < 8) {
            return setError('Password must be at least 8 characters');
        }
        try {
            await axios.post('/admin/change-password', { newPassword: changePasswordData.newPassword });
            setMustChangePassword(false);
            setView('dashboard');
            setChangePasswordData({ newPassword: '', confirmPassword: '' });
        } catch (error) {
            setError(error.response?.data?.error || 'Server error');
        }
    };

    // Fetch radios
    const fetchRadios = async () => {
        try {
            const response = await axios.get('/admin/radios');
            setRadios(response.data);
        } catch (error) {
            setError('Failed to fetch radios');
        }
    };

    // Fetch users
    const fetchUsers = async () => {
        try {
            const response = await axios.get('/admin/users');
            setUsers(response.data);
        } catch (error) {
            setError('Failed to fetch users');
        }
    };

    // Handle radio submit
    const handleRadioSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            if (editingRadioId) {
                await axios.put(`/admin/radios/${editingRadioId}`, newRadio);
                setEditingRadioId(null);
            } else {
                await axios.post('/admin/radios', newRadio);
            }
            setNewRadio({ name: '', stream_url: '', now_playing_api: '', enabled: true });
            fetchRadios();
        } catch (error) {
            setError(error.response?.data?.error || 'Failed to save radio');
        }
    };

    // Handle user submit
    const handleUserSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!editingUserId && newUser.password.length < 8) {
            return setError('Password must be at least 8 characters');
        }
        try {
            if (editingUserId) {
                const updateData = { username: newUser.username, enabled: newUser.enabled };
                if (newUser.password) updateData.password = newUser.password;
                await axios.put(`/admin/users/${editingUserId}`, updateData);
                setEditingUserId(null);
            } else {
                await axios.post('/admin/users', newUser);
            }
            setNewUser({ username: '', password: '', enabled: true });
            fetchUsers();
        } catch (error) {
            setError(error.response?.data?.error || 'Failed to save user');
        }
    };

    // Handle radio delete
    const handleRadioDelete = async (id) => {
        if (window.confirm('Are you sure you want to delete this radio station?')) {
            setError('');
            try {
                await axios.delete(`/admin/radios/${id}`);
                fetchRadios();
            } catch (error) {
                setError(error.response?.data?.error || 'Failed to delete radio');
            }
        }
    };

    // Handle user delete
    const handleUserDelete = async (id) => {
        if (window.confirm('Are you sure you want to delete this user?')) {
            setError('');
            try {
                await axios.delete(`/admin/users/${id}`);
                fetchUsers();
            } catch (error) {
                setError(error.response?.data?.error || 'Failed to delete user');
            }
        }
    };

    // Handle radio edit
    const handleRadioEdit = (radio) => {
        setNewRadio({
            name: radio.name,
            stream_url: radio.stream_url,
            now_playing_api: radio.now_playing_api || '',
            enabled: radio.enabled
        });
        setEditingRadioId(radio.id);
    };

    // Handle user edit
    const handleUserEdit = (user) => {
        setNewUser({
            username: user.username,
            password: '',
            enabled: user.enabled
        });
        setEditingUserId(user.id);
    };

    // Handle input changes
    const handleRadioChange = (e) => {
        const { name, value, type, checked } = e.target;
        setNewRadio(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleUserChange = (e) => {
        const { name, value, type, checked } = e.target;
        setNewUser(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleLoginChange = (e) => {
        const { name, value } = e.target;
        setLoginData(prev => ({ ...prev, [name]: value }));
    };

    const handleChangePasswordChange = (e) => {
        const { name, value } = e.target;
        setChangePasswordData(prev => ({ ...prev, [name]: value }));
    };

    // Logout
    const handleLogout = () => {
        localStorage.removeItem('token');
        setToken(null);
        setView('login');
        setMustChangePassword(false);
    };

    return (
        <div className="min-h-screen bg-gray-900 p-4 sm:p-6">
            {view === 'login' && (
                <div className="max-w-md mx-auto mt-20 bg-gray-800 p-6 rounded-lg shadow-lg">
                    <h2 className="text-2xl font-bold mb-4 text-center">Admin Login</h2>
                    {error && <div className="alert">{error}</div>}
                    <form onSubmit={handleLogin} className="space-y-4">
                        <input
                            name="username"
                            value={loginData.username}
                            onChange={handleLoginChange}
                            type="text"
                            placeholder="Username"
                            className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                            required
                        />
                        <input
                            name="password"
                            value={loginData.password}
                            onChange={handleLoginChange}
                            type="password"
                            placeholder="Password"
                            className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                            required
                        />
                        <button
                            type="submit"
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-all"
                        >
                            Login
                        </button>
                    </form>
                </div>
            )}
            {view === 'changePassword' && (
                <div className="max-w-md mx-auto mt-20 bg-gray-800 p-6 rounded-lg shadow-lg">
                    <h2 className="text-2xl font-bold mb-4 text-center">Change Password</h2>
                    {error && <div className="alert">{error}</div>}
                    <form onSubmit={handleChangePassword} className="space-y-4">
                        <input
                            name="newPassword"
                            value={changePasswordData.newPassword}
                            onChange={handleChangePasswordChange}
                            type="password"
                            placeholder="New Password"
                            className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                            required
                        />
                        <input
                            name="confirmPassword"
                            value={changePasswordData.confirmPassword}
                            onChange={handleChangePasswordChange}
                            type="password"
                            placeholder="Confirm Password"
                            className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                            required
                        />
                        <button
                            type="submit"
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-all"
                        >
                            Change Password
                        </button>
                    </form>
                </div>
            )}
            {view === 'dashboard' && (
                <div className="max-w-4xl mx-auto">
                    <div className="flex flex-col sm:flex-row justify-between items-center mb-6">
                        <h1 className="text-3xl font-bold">Car Radio Admin Panel</h1>
                        <button
                            onClick={handleLogout}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded transition-all mt-4 sm:mt-0"
                        >
                            Logout
                        </button>
                    </div>
                    {error && <div className="alert">{error}</div>}
                    <div className="mb-8 bg-gray-800 p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-semibold mb-4">{editingRadioId ? 'Edit Radio Station' : 'Add Radio Station'}</h2>
                        <form onSubmit={handleRadioSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <input
                                name="name"
                                value={newRadio.name}
                                onChange={handleRadioChange}
                                type="text"
                                placeholder="Radio Name"
                                className="p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                                required
                            />
                            <input
                                name="stream_url"
                                value={newRadio.stream_url}
                                onChange={handleRadioChange}
                                type="text"
                                placeholder="Stream URL"
                                className="p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                                required
                            />
                            <input
                                name="now_playing_api"
                                value={newRadio.now_playing_api}
                                onChange={handleRadioChange}
                                type="text"
                                placeholder="Now Playing API (optional)"
                                className="p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                            />
                            <label className="flex items-center">
                                <input
                                    name="enabled"
                                    type="checkbox"
                                    checked={newRadio.enabled}
                                    onChange={handleRadioChange}
                                    className="mr-2"
                                />
                                <span>Enabled</span>
                            </label>
                            <button
                                type="submit"
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-all col-span-1 sm:col-span-2"
                            >
                                {editingRadioId ? 'Update Radio' : 'Add Radio'}
                            </button>
                        </form>
                    </div>
                    <div className="mb-8 bg-gray-800 p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-semibold mb-4">{editingUserId ? 'Edit User' : 'Add User'}</h2>
                        <form onSubmit={handleUserSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <input
                                name="username"
                                value={newUser.username}
                                onChange={handleUserChange}
                                type="text"
                                placeholder="Username"
                                className="p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                                required
                            />
                            <input
                                name="password"
                                value={newUser.password}
                                onChange={handleUserChange}
                                type="password"
                                placeholder={editingUserId ? 'New Password (optional)' : 'Password'}
                                className="p-2 bg-gray-700 border border-gray-600 rounded text-white transition-all"
                                required={!editingUserId}
                            />
                            <label className="flex items-center">
                                <input
                                    name="enabled"
                                    type="checkbox"
                                    checked={newUser.enabled}
                                    onChange={handleUserChange}
                                    className="mr-2"
                                />
                                <span>Enabled</span>
                            </label>
                            <button
                                type="submit"
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-all col-span-1 sm:col-span-2"
                            >
                                {editingUserId ? 'Update User' : 'Add User'}
                            </button>
                        </form>
                    </div>
                    <div className="mb-8">
                        <h2 className="text-xl font-semibold mb-4">Radio Stations</h2>
                        <div className="grid gap-4">
                            {radios.map(radio => (
                                <div key={radio.id} className="bg-gray-800 p-4 rounded-lg shadow-lg flex flex-col sm:flex-row justify-between items-center">
                                    <div>
                                        <h3 className="text-lg font-semibold">{radio.name}</h3>
                                        <p className="text-sm">Stream: {radio.stream_url}</p>
                                        <p className="text-sm">API: {radio.now_playing_api || 'None'}</p>
                                        <p className="text-sm">Status: {radio.enabled ? 'Enabled' : 'Disabled'}</p>
                                    </div>
                                    <div className="flex space-x-2 mt-2 sm:mt-0">
                                        <button
                                            onClick={() => handleRadioEdit(radio)}
                                            className="bg-yellow-600 hover:bg-yellow-700 text-white p-2 rounded transition-all"
                                        >
                                            <i className="fas fa-edit"></i>
                                        </button>
                                        <button
                                            onClick={() => handleRadioDelete(radio.id)}
                                            className="bg-red-600 hover:bg-red-700 text-white p-2 rounded transition-all"
                                        >
                                            <i className="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold mb-4">Users</h2>
                        <div className="grid gap-4">
                            {users.map(user => (
                                <div key={user.id} className="bg-gray-800 p-4 rounded-lg shadow-lg flex flex-col sm:flex-row justify-between items-center">
                                    <div>
                                        <h3 className="text-lg font-semibold">{user.username}</h3>
                                        <p className="text-sm">Status: {user.enabled ? 'Enabled' : 'Disabled'}</p>
                                        <p className="text-sm">Must Change Password: {user.must_change_password ? 'Yes' : 'No'}</p>
                                    </div>
                                    <div className="flex space-x-2 mt-2 sm:mt-0">
                                        <button
                                            onClick={() => handleUserEdit(user)}
                                            className="bg-yellow-600 hover:bg-yellow-700 text-white p-2 rounded transition-all"
                                            disabled={user.username === 'admin'}
                                        >
                                            <i className="fas fa-edit"></i>
                                        </button>
                                        <button
                                            onClick={() => handleUserDelete(user.id)}
                                            className="bg-red-600 hover:bg-red-700 text-white p-2 rounded transition-all"
                                            disabled={user.username === 'admin'}
                                        >
                                            <i className="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

ReactDOM.render(<App />, document.getElementById('app'));