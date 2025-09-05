# Plumber Appointment Scheduling System

A comprehensive web-based appointment scheduling system designed for plumbing service companies. This demo application showcases a complete booking workflow from client request to appointment confirmation with multi-company support.

## 🚀 Features

### Multi-Company Management
- **3 Demo Companies**: Quick Fix Plumbing, Professional Drain Services, Emergency Plumbing 24/7
- **Company-Specific Calendars**: Each company has its own independent schedule
- **Admin Company Selection**: Switch between companies to manage their individual calendars
- **Cross-Company Booking**: Clients can book with any available company without choosing one themselves

### Admin Dashboard
- **Calendar View**: Visual month calendar with availability indicators
- **Day Schedule**: Detailed time slot management (8:00 AM - 6:00 PM, 30-minute slots)
- **Appointment Management**: Create temporary holds or confirmed appointments
- **Request Processing**: Review and approve client booking requests
- **Company Assignment**: Assign client requests to specific companies during approval

### Client Booking Interface
- **Service Selection**: Choose from predefined plumbing services
- **Dynamic Pricing**: Real-time price estimation based on service and answers
- **Smart Questionnaire**: Service-specific questions for accurate estimates
- **Time Selection**: View and select from all available time slots across companies
- **Request Submission**: Send booking requests for admin review

### Communication System
- **Email Simulation**: Mock email system showing all client communications
- **Automated Notifications**: Confirmation and rejection emails
- **Status Updates**: Real-time appointment status changes
- **Professional Templates**: Pre-formatted email content

### Service Catalog
- **Blockage/Verstopping Service**: 1-hour service with location-based pricing
- **Bathroom Renovation**: 2-hour consultation with quotation-based pricing
- **Dynamic Questions**: Service-specific forms for accurate estimates

## 🏗️ Architecture

### Data Structure
```javascript
state = {
    selectedCompanyId: 'C1',           // Currently selected company in admin
    schedule: {                        // Company-specific schedules
        'C1': { 'YYYY-MM-DD': ['FREE', 'TEMP', 'BOOKED', ...] },
        'C2': { 'YYYY-MM-DD': ['FREE', 'TEMP', 'BOOKED', ...] },
        'C3': { 'YYYY-MM-DD': ['FREE', 'TEMP', 'BOOKED', ...] }
    },
    appts: {                          // Appointments with company assignment
        '1': {
            companyId: 'C1',
            companyName: 'Quick Fix Plumbing',
            dateKey: '2025-09-05',
            startIdx: 4,              // Time slot index
            endIdx: 6,
            status: 'CONFIRMED',
            customerName: 'John Doe',
            email: 'john@example.com'
        }
    },
    requests: [{                      // Client requests
        id: 1,
        customer: { name: '...', email: '...' },
        serviceId: 'S1',
        availableCompanies: ['C1', 'C2'],  // Companies with free slots
        preferred: { dateKey, startIdx, endIdx },
        hold: { dateKey, startIdx, endIdx, companyId },  // Temporary hold
        status: 'NEW'
    }]
}
```

### Key Components

#### Schedule Management
- **Time Slots**: 30-minute increments from 8:00 AM to 6:00 PM
- **Slot States**: FREE (available), TEMP (temporarily held), BOOKED (confirmed)
- **Company Isolation**: Each company maintains separate availability

#### Appointment Lifecycle
1. **Client Request** → Temporary hold placed on available company
2. **Admin Review** → Choose company and approve/modify time
3. **Confirmation** → Email sent, slot marked as BOOKED
4. **Management** → Admin can modify or cancel appointments

#### Request Processing Flow
1. Client submits request with preferred time
2. System identifies companies with available slots
3. Temporary hold placed on one company's calendar
4. Admin reviews request and selects final company assignment
5. Appointment confirmed and customer notified

## 📱 User Interfaces

### Admin Dashboard
- **Company Selector**: Dropdown to switch between company calendars
- **Month Calendar**: Visual grid showing days with availability indicators
- **Day View**: Detailed time slots with appointment information
- **Appointment Controls**: Create temp holds or confirmed appointments
- **Request Queue**: List of pending client requests with approval options

### Client Booking Page
- **Personal Information**: Name and email collection
- **Service Selection**: Choose from available plumbing services
- **Service Questionnaire**: Dynamic forms based on selected service
- **Price Estimation**: Real-time cost calculation
- **Date & Time Selection**: Available slots from all companies
- **Request Submission**: Send booking request for admin review

### Email Simulator
- **Inbox View**: All generated emails displayed chronologically
- **Email Actions**: Approve/reject buttons for appointment confirmations
- **Status Tracking**: Visual indicators for email status

## 🎯 Workflow Examples

### Scenario 1: Admin Direct Booking
1. Admin selects "Quick Fix Plumbing" from company dropdown
2. Chooses date and time slot
3. Enters customer details
4. Creates confirmed appointment
5. System sends confirmation email to customer

### Scenario 2: Client Self-Service Booking
1. Client fills personal information
2. Selects "Blockage/Verstopping" service
3. Answers service-specific questions (location, severity)
4. Views available time slots from all companies
5. Selects preferred time and submits request
6. System places temporary hold and notifies admin
7. Admin reviews request and assigns to "Professional Drain Services"
8. Customer receives confirmation email with company details

### Scenario 3: Request Management
1. Admin receives client request in queue
2. Views available companies for requested time slot
3. Chooses company assignment based on capacity/specialty
4. Approves request or proposes alternative time
5. System updates calendars and sends notifications

## 🛠️ Technical Implementation

### Frontend Technologies
- **HTML5**: Semantic markup with accessibility features
- **CSS3**: Custom variables, grid layouts, responsive design
- **Vanilla JavaScript**: No external dependencies, modern ES6+ features

### Storage & Persistence
- **localStorage**: Client-side data persistence
- **Version Control**: Storage key versioning for data migrations
- **State Management**: Centralized state with automatic saving

### Responsive Design
- **Mobile-First**: Optimized for all screen sizes
- **Grid Layouts**: Flexible layouts that adapt to viewport
- **Touch-Friendly**: Large buttons and easy navigation

### Code Organization
- **Modular Functions**: Separate concerns for maintainability
- **Event-Driven**: DOM events trigger state changes
- **Error Handling**: Graceful degradation and user feedback

## 📋 Feature Details

### Service Configuration
Services are defined with:
- **Duration**: Time slots required for service
- **Base Price**: Starting price for calculations
- **Questions**: Dynamic form fields for estimates
- **Pricing Logic**: Custom functions for price calculation

### Time Management
- **Working Hours**: 8:00 AM to 6:00 PM
- **Slot Duration**: 30-minute increments
- **Booking Buffer**: Automatic slot management
- **Time Validation**: Prevents overlapping appointments

### Company Management
- **Company Profiles**: Name, ID, and color coding
- **Independent Schedules**: Separate calendars per company
- **Resource Allocation**: Smart assignment during booking
- **Availability Tracking**: Real-time slot monitoring

### Email System
- **Template Engine**: Dynamic email content generation
- **Status Tracking**: Delivery and response monitoring
- **Action Integration**: Direct actions from email interface
- **Professional Formatting**: HTML email templates

## 🔧 Configuration

### Adding New Companies
```javascript
const COMPANIES = [
    { id: 'C4', name: 'New Plumbing Co', color: '#purple' }
];
```

### Creating New Services
```javascript
const SERVICES = [
    {
        id: 'S3',
        name: 'Emergency Repair',
        durationSlots: 1,
        base: 150,
        questions: [
            { key: 'urgency', label: 'Urgency Level', type: 'select', 
              options: ['Normal', 'Urgent', 'Emergency'] }
        ],
        price: (answers) => answers.urgency === 'Emergency' ? 200 : 150
    }
];
```

### Customizing Working Hours
```javascript
const WORK_START = 8;  // 8:00 AM
const WORK_END = 18;   // 6:00 PM
const SLOT_MIN = 30;   // 30-minute slots
```

## 🧪 Testing & Demo Data

### Seed Data
The application automatically creates demo data on first run:
- Sample appointments across different companies
- Demo client requests
- Email history examples

### Test Scenarios
1. **Multi-Company Booking**: Test slot availability across companies
2. **Request Approval**: Verify admin can assign to different companies
3. **Email Flow**: Confirm all notification emails are generated
4. **Calendar Management**: Test appointment creation and modification
5. **Data Persistence**: Verify state is saved and restored

## 📈 Usage Analytics

### Key Metrics Tracked
- Appointment creation and confirmation rates
- Request processing times
- Company utilization rates
- Service popularity
- Client communication effectiveness

### Performance Considerations
- **Local Storage Limits**: Monitor data size growth
- **Rendering Optimization**: Efficient DOM updates
- **Memory Management**: Clean up event listeners
- **State Synchronization**: Consistent data across views

## 🚀 Deployment & Setup

### Local Development
1. Clone the repository
2. Open `index.html` in a web browser
3. No build process required - runs directly in browser

### Browser Compatibility
- **Modern Browsers**: Chrome 70+, Firefox 65+, Safari 12+
- **Mobile Browsers**: iOS Safari 12+, Chrome Mobile 70+
- **Features Used**: ES6+, CSS Grid, localStorage

### File Structure
```
plumber-calendar/
├── index.html          # Main application page
├── app.js             # Complete application logic
├── styles.css         # All styling and responsive design
├── README.md          # This documentation
└── MULTI_COMPANY_CHANGES.md  # Implementation details
```

## 🔄 Future Enhancements

### Planned Features
- **Calendar Integration**: Export to Google Calendar/iCal
- **SMS Notifications**: Text message confirmations
- **Payment Processing**: Online payment integration
- **Recurring Appointments**: Scheduled maintenance bookings
- **Staff Management**: Technician assignment and scheduling
- **Service Area Mapping**: Geographic service boundaries
- **Customer History**: Previous service records
- **Inventory Tracking**: Parts and equipment management

### Technical Improvements
- **Backend Integration**: API connectivity for production use
- **Real-time Updates**: WebSocket connections for live updates
- **Advanced Filtering**: Search and filter appointments
- **Bulk Operations**: Mass appointment management
- **Reporting Dashboard**: Analytics and insights
- **Multi-language Support**: Internationalization
- **Accessibility Enhancements**: WCAG compliance improvements

## 📞 Support & Documentation

### Getting Help
- Review this README for comprehensive information
- Check `MULTI_COMPANY_CHANGES.md` for implementation details
- Examine code comments for function-specific documentation
- Test with provided demo data to understand workflows

### Contributing
- Follow existing code style and patterns
- Update README when adding new features
- Test multi-company scenarios thoroughly
- Maintain backward compatibility when possible

---

**Last Updated**: September 5, 2025  
**Version**: 4.0 (Multi-Company Support)  
**Compatibility**: Modern Browsers, Mobile-Responsive
